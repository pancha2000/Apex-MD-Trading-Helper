'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
//  backtest.js  —  30-Day AI Batch Backtest + Strategy Optimizer
//  Memory-Safe: 6 chunks × 5 days, one chunk in RAM at a time (~64 KB peak)
//  Commands: .backtest | .clearbacktest | .scanbacktest
// ═══════════════════════════════════════════════════════════════════════════════

const { cmd }      = require('../lib/commands');
const config       = require('../config');
const axios        = require('axios');
const mongoose     = require('mongoose');
const indicators   = require('../lib/indicators');
const smc          = require('../lib/smartmoney');

const {
    calculateStochRSI,
    calculateBollingerBands,
    checkMTFRSIConfluence,
    detectVolumeNodes,
    detectMTFOBs,
} = require('../lib/indicators');

// ══════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════
const CHUNK_DAYS          = 5;       // trading days per chunk
const LOOKBACK_DAYS       = 2;       // extra days prepended for indicator warm-up
const NUM_CHUNKS          = 6;       // 6 × 5 = 30 days
const INTER_CHUNK_MS      = 500;     // ms between chunk fetches (rate-limit safety)
const MIN_SCORE           = 8;       // minimum score to simulate a trade
const MIN_ADX             = 20;      // minimum ADX value to accept a signal
const MIN_STRATEGY_TRADES = 3;       // min closed trades needed for a strategy stat
const CANDLES_PER_DAY_15M = 96;      // 15m candles in one day
const TRADE_SKIP          = 15;      // candles to advance after each simulated trade
const SIM_MAX_CANDLES     = 200;     // max forward candles for TP/SL simulation

// TP multipliers (in units of 1R = 2 × ATR)
const TP1_R = 1.5;
const TP2_R = 3.0;
const TP3_R = 5.0;
const SL_R  = 2.0;   // SL = entry ± ATR × SL_R

// ══════════════════════════════════════════════════════════
//  MONGODB MODEL  (strict:false → no schema migration needed)
// ══════════════════════════════════════════════════════════
let BacktestResult;
try {
    BacktestResult = mongoose.model('BacktestResult');
} catch (_) {
    BacktestResult = mongoose.model(
        'BacktestResult',
        new mongoose.Schema({}, { strict: false, timestamps: true })
    );
}

// ══════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Wrap any synchronous call so a single indicator failure never crashes a chunk */
function safe(fn, fallback = null) {
    try { return fn(); } catch (_) { return fallback; }
}

// ══════════════════════════════════════════════════════════
//  DATA FETCHING  —  Precise startTime / endTime via REST
// ══════════════════════════════════════════════════════════
async function fetchKlinesRange(symbol, interval, startMs, endMs) {
    const res = await axios.get('https://api.binance.com/api/v3/klines', {
        params: {
            symbol,
            interval,
            startTime: startMs,
            endTime:   endMs,
            limit:     1000,
        },
        timeout: 15000,
    });
    return res.data;   // array of kline arrays
}

// ══════════════════════════════════════════════════════════
//  DAILY BIAS  —  lightweight, derived from 15m structure
//  Compares last-3-day swing vs prior-3-day swing (HH/HL → BULLISH)
// ══════════════════════════════════════════════════════════
function computeDailyBias(candles) {
    const D = CANDLES_PER_DAY_15M;
    if (candles.length < 6 * D) return 'NEUTRAL';

    const recentSlice = candles.slice(-3 * D);
    const priorSlice  = candles.slice(-6 * D, -3 * D);

    const recentH = Math.max(...recentSlice.map(c => parseFloat(c[2])));
    const recentL = Math.min(...recentSlice.map(c => parseFloat(c[3])));
    const priorH  = Math.max(...priorSlice.map(c => parseFloat(c[2])));
    const priorL  = Math.min(...priorSlice.map(c => parseFloat(c[3])));

    if (recentH > priorH && recentL > priorL) return 'BULLISH';   // HH + HL
    if (recentH < priorH && recentL < priorL) return 'BEARISH';   // LH + LL
    return 'RANGING';
}

// ══════════════════════════════════════════════════════════
//  CORE SCORER  —  v7 Adaptive ADX Weighting
//  Returns COMPACT metadata object (~300 bytes) — no candle refs kept
// ══════════════════════════════════════════════════════════
function scoreCandleWithMeta(candles, idx) {
    // Need at least 200 candles before idx for EMA-200 warm-up
    if (idx < 200 || idx >= candles.length) return null;

    // Pre-slice once to avoid repeated slicing inside each indicator
    const slice200 = candles.slice(idx - 200, idx);
    const slice100 = candles.slice(idx - 100, idx);
    const slice60  = candles.slice(idx - 60,  idx);
    const slice50  = candles.slice(idx - 50,  idx);
    const slice30  = candles.slice(idx - 30,  idx);
    const slice20  = candles.slice(idx - 20,  idx);
    const slice15  = candles.slice(idx - 15,  idx);
    const slice10  = candles.slice(idx - 10,  idx);

    const currentPrice = parseFloat(candles[idx - 1][4]);
    if (!currentPrice || currentPrice <= 0) return null;

    // ── ADX Regime Detection ──────────────────────────────
    let adxVal     = 20;
    let marketRegime = 'NEUTRAL';
    let smcW = 1.0, retailW = 1.0;

    const adxData = safe(() => indicators.calculateADX(slice50));
    if (adxData) {
        adxVal = adxData.value || 20;
        if      (adxVal > 25) { marketRegime = 'TRENDING'; smcW = 1.5; retailW = 0.7; }
        else if (adxVal < 20) { marketRegime = 'RANGING';  smcW = 0.7; retailW = 1.5; }
    }

    // Reject low-momentum candles early
    if (adxVal < MIN_ADX) return null;

    // ── ATR (needed for trade sizing) ─────────────────────
    const atrRaw = safe(() => parseFloat(indicators.calculateATR(slice50)));
    if (!atrRaw || atrRaw <= 0) return null;

    // ── EMA Trend Bias ────────────────────────────────────
    let aboveEma200 = false;
    const ema200 = safe(() => parseFloat(indicators.calculateEMA(slice200, 200)));
    if (ema200) aboveEma200 = currentPrice > ema200;

    // ════════════════════════════════════════════
    //  SMC GROUP  (weighted ×smcW in trending markets)
    // ════════════════════════════════════════════
    let smcL = 0, smcS = 0;

    // Flags for strategy dimension analysis
    let hasChoCH     = false;
    let hasSweep     = false;
    let hasBullOB    = false;
    let hasBearOB    = false;
    let hasHarmonic  = false;
    let hasICT       = false;
    let hasBreaker   = false;

    // — Order Blocks & FVG (analyzeSMC) —
    const marketSMC = safe(() => smc.analyzeSMC(slice50));
    if (marketSMC) {
        if (marketSMC.bullishOB)                              { smcL++; hasBullOB = true; }
        if (marketSMC.bearishOB)                              { smcS++; hasBearOB = true; }
        if (marketSMC.sweep && marketSMC.sweep.includes('Bullish')) smcL++;
        if (marketSMC.sweep && marketSMC.sweep.includes('Bearish')) smcS++;
        if (marketSMC.choch && marketSMC.choch.includes('Bullish')) smcL++;
        if (marketSMC.choch && marketSMC.choch.includes('Bearish')) smcS++;
    }

    // — Liquidity Sweep (+2, strong ICT signal) —
    const sweep = safe(() => smc.checkLiquiditySweep(slice15));
    if (sweep) {
        if (sweep.includes('Bullish')) { smcL += 2; hasSweep = true; }
        if (sweep.includes('Bearish')) { smcS += 2; hasSweep = true; }
    }

    // — Change of Character (+2, reversal confirmed) —
    const choch = safe(() => smc.checkChoCH(slice20));
    if (choch) {
        if (choch.includes('Bullish')) { smcL += 2; hasChoCH = true; }
        if (choch.includes('Bearish')) { smcS += 2; hasChoCH = true; }
    }

    // — Harmonic Pattern (+2, high-probability reversal) —
    const harmonic = safe(() => indicators.checkHarmonicPattern(slice100));
    if (harmonic) {
        if (harmonic.includes('Bullish')) { smcL += 2; hasHarmonic = true; }
        if (harmonic.includes('Bearish')) { smcS += 2; hasHarmonic = true; }
    }

    // — ICT Silver Bullet (+1, session-time confirmation) —
    const ict = safe(() => indicators.checkICTSilverBullet(slice10));
    if (ict) {
        if (ict.includes('Bullish')) { smcL++; hasICT = true; }
        if (ict.includes('Bearish')) { smcS++; hasICT = true; }
    }

    // — Short-Term Order Block extras (+1) —
    const mtfOBs = safe(() => detectMTFOBs(slice15));
    if (mtfOBs) {
        if (mtfOBs.bullish) { smcL++; hasBreaker = true; }
        if (mtfOBs.bearish) { smcS++; hasBreaker = true; }
    }

    // ════════════════════════════════════════════
    //  RETAIL GROUP  (weighted ×retailW in ranging markets)
    // ════════════════════════════════════════════
    let retL = 0, retS = 0;

    // Flags
    let hasRsi        = false;
    let hasMacd       = false;
    let hasStochRsi   = false;
    let hasBB         = false;
    let hasFibConf    = false;   // reused for MTF RSI
    let hasVolBreak   = false;
    let hasDivergence = false;
    let hasVolNode    = false;

    // — RSI —
    const rsi = safe(() => indicators.calculateRSI(slice50, 14));
    if (rsi !== null) {
        if (rsi < 45) { retL++; hasRsi = true; }
        if (rsi > 55) { retS++; hasRsi = true; }
    }

    // — MACD —
    const macd = safe(() => indicators.calculateMACD(slice50));
    if (macd) {
        if (macd.includes('Bullish')) { retL++; hasMacd = true; }
        if (macd.includes('Bearish')) { retS++; hasMacd = true; }
    }

    // — Stochastic RSI —
    const stochRSI = safe(() => calculateStochRSI(slice60));
    if (stochRSI) {
        if (stochRSI.isBull) { retL++; hasStochRsi = true; }
        if (stochRSI.isBear) { retS++; hasStochRsi = true; }
    }

    // — Bollinger Bands —
    const bbands = safe(() => calculateBollingerBands(slice30));
    if (bbands) {
        if (bbands.isBull) { retL++; hasBB = true; }
        if (bbands.isBear) { retS++; hasBB = true; }
        if (bbands.squeeze) { retL += 0.5; retS += 0.5; }   // pending breakout benefits both
    }

    // — Volume Breakout —
    const volBreak = safe(() => indicators.checkVolumeBreakout(slice50));
    if (volBreak) {
        if (volBreak.includes('Bullish Breakout')) { retL++; hasVolBreak = true; }
        if (volBreak.includes('Bearish Breakout')) { retS++; hasVolBreak = true; }
    }

    // — RSI Divergence —
    const divergence = safe(() => indicators.checkDivergence(slice50));
    if (divergence) {
        if (divergence.includes('Bullish')) { retL++; hasDivergence = true; }
        if (divergence.includes('Bearish')) { retS++; hasDivergence = true; }
    }

    // — MTF RSI Confluence (+1 or +2 for strong signal) —
    const mtfRSI = safe(() => checkMTFRSIConfluence(slice50, slice50)); // 1H approx
    if (mtfRSI) {
        if (mtfRSI.isBull) { retL += mtfRSI.signal === 'STRONG_BULL' ? 2 : 1; hasFibConf = true; }
        if (mtfRSI.isBear) { retS += mtfRSI.signal === 'STRONG_BEAR' ? 2 : 1; hasFibConf = true; }
    }

    // — Volume Nodes (HVN = high-probability reaction zone) —
    const volNodes = safe(() => detectVolumeNodes(slice100));
    if (volNodes && volNodes.nearHVN) {
        retL += 0.5; retS += 0.5; hasVolNode = true;
    }

    // — VWAP Bias —
    const vwap = safe(() => indicators.calculateVWAP(slice100));
    if (vwap) {
        if (vwap.includes('🟢')) retL++;
        if (vwap.includes('🔴')) retS++;
    }

    // — Candle Pattern —
    const pattern = safe(() => indicators.checkCandlePattern(slice10));
    if (pattern) {
        if (pattern.includes('🟢')) retL++;
        if (pattern.includes('🔴')) retS++;
    }

    // — EMA trend micro-bias —
    if (aboveEma200) retL += 0.5;
    else             retS += 0.5;

    // ════════════════════════════════════════════
    //  v7 ADAPTIVE WEIGHTED SCORE
    // ════════════════════════════════════════════
    let longScore  = smcL * smcW + retL * retailW;
    let shortScore = smcS * smcW + retS * retailW;

    // — Golden Confluence Bonus: +10 when BOTH groups fire strongly —
    const goldenL = smcL >= 4 && retL >= 3;
    const goldenS = smcS >= 4 && retS >= 3;
    if (goldenL) longScore  += 10;
    if (goldenS) shortScore += 10;

    // — Reject if below minimum threshold —
    const bestScore = Math.max(longScore, shortScore);
    if (bestScore < MIN_SCORE) return null;

    const isLong = longScore >= shortScore;

    // ── Return compact metadata object (no candle references) ──
    return {
        currentPrice,
        isLong,
        bestScore: Math.floor(bestScore),
        smcScore:  Math.round(isLong ? smcL : smcS),
        retScore:  Math.round(isLong ? retL : retS),
        atr:       atrRaw,
        adxVal:    Math.round(adxVal),
        marketRegime,
        // Strategy flags (1 byte each)
        isGolden:    isLong ? goldenL : goldenS,
        hasChoCH,
        hasSweep,
        hasHarmonic,
        hasICT,
        hasBreaker,
        hasBullOB,
        hasBearOB,
        hasRsi,
        hasMacd,
        hasStochRsi,
        hasBB,
        hasFibConf,
        hasVolBreak,
        hasDivergence,
        hasVolNode,
    };
}

// ══════════════════════════════════════════════════════════
//  TRADE SIMULATOR  —  TP1/TP2/TP3 Partial-Close Model
//  33% closed at TP1 (1.5R), 33% at TP2 (3R), 34% at TP3 (5R)
// ══════════════════════════════════════════════════════════
function simTrade(candles, entryIdx, entry, sl, tp1, tp2, tp3, isLong) {
    let tp1Hit = false, tp2Hit = false;
    let pnlR   = 0;
    const R    = Math.abs(entry - sl);   // 1R definition

    if (R <= 0) return { result: 'LOSS', pnlR: -1, tp1Hit, tp2Hit };

    const endIdx = Math.min(candles.length, entryIdx + SIM_MAX_CANDLES);

    for (let j = entryIdx; j < endIdx; j++) {
        const hi = parseFloat(candles[j][2]);
        const lo = parseFloat(candles[j][3]);

        if (isLong) {
            // Stop-loss hit
            if (lo <= sl) {
                const remaining = tp2Hit ? 0.34 : (tp1Hit ? 0.67 : 1.0);
                pnlR += -remaining * 1.0;
                return { result: 'LOSS', pnlR: parseFloat(pnlR.toFixed(2)), tp1Hit, tp2Hit };
            }
            if (!tp1Hit && hi >= tp1) { tp1Hit = true; pnlR += 0.33 * ((tp1 - entry) / R); }
            if (tp1Hit && !tp2Hit && hi >= tp2) { tp2Hit = true; pnlR += 0.33 * ((tp2 - entry) / R); }
            if (tp2Hit && hi >= tp3) {
                pnlR += 0.34 * ((tp3 - entry) / R);
                return { result: 'WIN', pnlR: parseFloat(pnlR.toFixed(2)), tp1Hit, tp2Hit };
            }
        } else {
            // Stop-loss hit
            if (hi >= sl) {
                const remaining = tp2Hit ? 0.34 : (tp1Hit ? 0.67 : 1.0);
                pnlR += -remaining * 1.0;
                return { result: 'LOSS', pnlR: parseFloat(pnlR.toFixed(2)), tp1Hit, tp2Hit };
            }
            if (!tp1Hit && lo <= tp1) { tp1Hit = true; pnlR += 0.33 * ((entry - tp1) / R); }
            if (tp1Hit && !tp2Hit && lo <= tp2) { tp2Hit = true; pnlR += 0.33 * ((entry - tp2) / R); }
            if (tp2Hit && lo <= tp3) {
                pnlR += 0.34 * ((entry - tp3) / R);
                return { result: 'WIN', pnlR: parseFloat(pnlR.toFixed(2)), tp1Hit, tp2Hit };
            }
        }
    }

    // Trade expired — close remaining at last candle's close price
    const lastClose = parseFloat(candles[endIdx - 1][4]);
    const remaining = tp2Hit ? 0.34 : (tp1Hit ? 0.67 : 1.0);
    pnlR += remaining * (isLong ? (lastClose - entry) / R : (entry - lastClose) / R);

    return {
        result: pnlR > 0 ? 'WIN' : 'LOSS',
        pnlR:   parseFloat(pnlR.toFixed(2)),
        tp1Hit,
        tp2Hit,
    };
}

// ══════════════════════════════════════════════════════════
//  CHUNK PROCESSOR  —  scan one chunk, return metadata ONLY
//  (candle arrays are NOT stored — only ~300 byte objects)
// ══════════════════════════════════════════════════════════
function processChunk(candles, tradeFromIdx, dailyBias) {
    const meta = [];
    let i = Math.max(200, tradeFromIdx);   // skip warm-up zone

    while (i < candles.length - 30) {
        const scored = scoreCandleWithMeta(candles, i);
        if (!scored) { i++; continue; }

        const { currentPrice, isLong, atr } = scored;
        const entry = currentPrice;
        const R     = atr * SL_R;

        const sl  = isLong ? entry - R          : entry + R;
        const tp1 = isLong ? entry + R * TP1_R  : entry - R * TP1_R;
        const tp2 = isLong ? entry + R * TP2_R  : entry - R * TP2_R;
        const tp3 = isLong ? entry + R * TP3_R  : entry - R * TP3_R;

        const { result, pnlR, tp1Hit, tp2Hit } = simTrade(candles, i, entry, sl, tp1, tp2, tp3, isLong);

        // Push ONLY the compact metadata object — no candle references
        meta.push({
            dir:          isLong ? 'LONG' : 'SHORT',
            result,
            pnlR,
            score:        scored.bestScore,
            smcScore:     scored.smcScore,
            retScore:     scored.retScore,
            adxVal:       scored.adxVal,
            marketRegime: scored.marketRegime,
            dailyBias,
            // Strategy dimension flags
            isGolden:     scored.isGolden,
            hasChoCH:     scored.hasChoCH,
            hasSweep:     scored.hasSweep,
            hasHarmonic:  scored.hasHarmonic,
            hasICT:       scored.hasICT,
            hasBreaker:   scored.hasBreaker,
            hasBullOB:    scored.hasBullOB,
            hasBearOB:    scored.hasBearOB,
            hasRsi:       scored.hasRsi,
            hasMacd:      scored.hasMacd,
            hasStochRsi:  scored.hasStochRsi,
            hasBB:        scored.hasBB,
            hasFibConf:   scored.hasFibConf,
            hasVolBreak:  scored.hasVolBreak,
            hasDivergence:scored.hasDivergence,
            hasVolNode:   scored.hasVolNode,
            tp1Hit,
            tp2Hit,
        });

        i += TRADE_SKIP;   // skip forward to avoid overlapping trade windows
    }

    return meta;
}

// ══════════════════════════════════════════════════════════
//  AI STRATEGY OPTIMIZER  —  17 dimension analysis
// ══════════════════════════════════════════════════════════
function analyzeStrategies(allMeta) {
    /** Compute stats for a subset of trade metadata */
    function stats(subset, label) {
        if (!subset || subset.length < MIN_STRATEGY_TRADES) return null;
        const wins   = subset.filter(t => t.result === 'WIN').length;
        const losses = subset.filter(t => t.result === 'LOSS').length;
        const total  = wins + losses;
        if (total < MIN_STRATEGY_TRADES) return null;

        const wr   = (wins / total) * 100;
        const pnlR = subset.reduce((s, t) => s + t.pnlR, 0);
        const gW   = subset.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
        const gL   = Math.abs(subset.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
        const pf   = gL > 0 ? gW / gL : (gW > 0 ? 99 : 0);

        return { label, wr, trades: total, wins, losses, pnlR, pf };
    }

    const isWithBias  = t => (t.dir === 'LONG'  && t.dailyBias === 'BULLISH') ||
                              (t.dir === 'SHORT' && t.dailyBias === 'BEARISH');
    const isAgainst   = t => (t.dir === 'LONG'  && t.dailyBias === 'BEARISH') ||
                              (t.dir === 'SHORT' && t.dailyBias === 'BULLISH');

    return [
        stats(allMeta,                                                        '📊 All Signals'),
        stats(allMeta.filter(t => t.isGolden),                               '🌟 Golden Confluence (SMC+Retail)'),
        stats(allMeta.filter(t => t.smcScore >= 5 && t.retScore < 3),        '🏗️ SMC Dominant Only'),
        stats(allMeta.filter(t => t.retScore >= 4 && t.smcScore < 4),        '📈 Retail Dominant Only'),
        stats(allMeta.filter(t => t.hasChoCH && t.hasSweep),                 '🔄 ChoCH + Liq. Sweep'),
        stats(allMeta.filter(t => t.hasHarmonic),                             '🔺 Harmonic Pattern'),
        stats(allMeta.filter(t => t.hasICT),                                  '🎯 ICT Silver Bullet'),
        stats(allMeta.filter(t => t.hasBreaker),                              '🔲 Breaker Block OB'),
        stats(allMeta.filter(t => t.hasFibConf),                              '🔢 MTF RSI Confluence'),
        stats(allMeta.filter(t => t.hasVolBreak),                             '💥 Volume Breakout'),
        stats(allMeta.filter(t => t.hasDivergence),                           '↩️ RSI Divergence'),
        stats(allMeta.filter(t => t.marketRegime === 'TRENDING'),             '🚀 Trending (ADX>25)'),
        stats(allMeta.filter(t => t.marketRegime === 'RANGING'),              '↔️ Ranging (ADX<20)'),
        stats(allMeta.filter(isWithBias),                                     '📅 With Daily Bias'),
        stats(allMeta.filter(isAgainst),                                      '⚠️ Counter Daily Bias'),
        stats(allMeta.filter(t => t.isGolden && t.hasChoCH),                 '👑 Golden + ChoCH'),
        stats(allMeta.filter(t => t.hasHarmonic && t.hasSweep),               '⚡ Harmonic + Sweep'),
    ].filter(Boolean).sort((a, b) => b.wr - a.wr);
}

// ══════════════════════════════════════════════════════════
//  MESSAGE BUILDER  —  Beautiful structured WhatsApp output
// ══════════════════════════════════════════════════════════
function buildOutputMessage(coin, tf, allMeta, strategies, chunksOk) {
    const coinName = coin.replace('USDT', '');

    // ── Overall stats ──
    const wins   = allMeta.filter(t => t.result === 'WIN').length;
    const losses = allMeta.filter(t => t.result === 'LOSS').length;
    const total  = wins + losses;
    const wr     = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    const netRNum = allMeta.reduce((s, t) => s + t.pnlR, 0);
    const netR   = (netRNum >= 0 ? '+' : '') + netRNum.toFixed(2);
    const grossW = allMeta.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
    const grossL = Math.abs(allMeta.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
    const pfNum  = grossL > 0 ? grossW / grossL : (grossW > 0 ? 99 : 0);
    const pf     = pfNum >= 99 ? '∞' : pfNum.toFixed(2);
    const longT  = allMeta.filter(t => t.dir === 'LONG').length;
    const shortT = allMeta.filter(t => t.dir === 'SHORT').length;

    // Max consecutive losses
    let maxConsec = 0, currStreak = 0;
    for (const t of allMeta) {
        if (t.result === 'LOSS') { currStreak++; maxConsec = Math.max(maxConsec, currStreak); }
        else currStreak = 0;
    }

    // Max drawdown in R-units
    let peak = 0, maxDD = 0, cumR = 0;
    for (const t of allMeta) {
        cumR += t.pnlR;
        if (cumR > peak) peak = cumR;
        const dd = peak - cumR;
        if (dd > maxDD) maxDD = dd;
    }

    // ── Regime breakdown ──
    const trendTrades = allMeta.filter(t => t.marketRegime === 'TRENDING');
    const rangeTrades = allMeta.filter(t => t.marketRegime === 'RANGING');
    const trendW = trendTrades.filter(t => t.result === 'WIN').length;
    const rangeW = rangeTrades.filter(t => t.result === 'WIN').length;
    const trendWR = trendTrades.length ? ((trendW / trendTrades.length) * 100).toFixed(0) : 'N/A';
    const rangeWR = rangeTrades.length ? ((rangeW / rangeTrades.length) * 100).toFixed(0) : 'N/A';

    // ── Daily Bias breakdown ──
    const withBias    = allMeta.filter(t => (t.dir==='LONG'&&t.dailyBias==='BULLISH')||(t.dir==='SHORT'&&t.dailyBias==='BEARISH'));
    const againstBias = allMeta.filter(t => (t.dir==='LONG'&&t.dailyBias==='BEARISH')||(t.dir==='SHORT'&&t.dailyBias==='BULLISH'));
    const biasW  = withBias.filter(t => t.result === 'WIN').length;
    const antiW  = againstBias.filter(t => t.result === 'WIN').length;
    const biasWR = withBias.length    ? ((biasW / withBias.length) * 100).toFixed(0)    : 'N/A';
    const antiWR = againstBias.length ? ((antiW / againstBias.length) * 100).toFixed(0) : 'N/A';

    // ── Grade labels ──
    const pfGrade = pfNum >= 2.5 ? '🏆 Elite' : pfNum >= 1.8 ? '✅ Excellent' : pfNum >= 1.3 ? '👍 Good' : pfNum >= 1.0 ? '⚠️ Marginal' : '❌ Poor';
    const wrNum   = parseFloat(wr);
    const wrEmoji = wrNum >= 65 ? '🟢' : wrNum >= 50 ? '🟡' : '🔴';

    // ── Verdict ──
    let verdict, verdictEmoji;
    if (pfNum >= 1.8 && wrNum >= 60) {
        verdict = `TRADE THIS COIN! ✅\n   ✨ Best Setup: ${strategies[0]?.label || 'N/A'}\n   🔖 Run *.future ${coinName}* for live signal`;
        verdictEmoji = '🟢';
    } else if (pfNum >= 1.3 && wrNum >= 50) {
        verdict = `MARGINAL — Use Top Strategy Filter Only ⚠️\n   ✏️ Apply: *${strategies[0]?.label || 'best strategy'}* filter`;
        verdictEmoji = '🟡';
    } else {
        verdict = `AVOID — Low Edge Detected ❌\n   💡 Consider a different coin or timeframe`;
        verdictEmoji = '🔴';
    }

    // ── Top 3 strategies ──
    const medals = ['🥇', '🥈', '🥉'];
    const top3 = strategies.slice(0, 3);
    const topBlock = top3.map((s, i) =>
        `${medals[i]} *${s.label}*\n` +
        `   📊 *${s.wr.toFixed(1)}%* WR  (${s.wins}W / ${s.losses}L / ${s.trades} total)\n` +
        `   💰 PF: ${s.pf.toFixed(2)}  |  Net: ${s.pnlR >= 0 ? '+' : ''}${s.pnlR.toFixed(2)}R`
    ).join('\n\n');

    // ── Worst strategies (below 50% WR) ──
    const worst2 = [...strategies].filter(s => s.wr < 50).sort((a, b) => a.wr - b.wr).slice(0, 2);
    const worstBlock = worst2.length
        ? worst2.map(s => `❌ *${s.label}*\n   ${s.wr.toFixed(1)}% WR (${s.trades} trades)  ← Skip on this coin`).join('\n')
        : '✅ All analyzed strategies above 50% WR — strong edge across the board!';

    // ── Best strategy tip ──
    const STRATEGY_TIPS = {
        '🌟 Golden Confluence (SMC+Retail)': 'Require SMC score ≥4 AND Retail score ≥3 simultaneously. Never enter on one group alone.',
        '🔄 ChoCH + Liq. Sweep':            'Both signals MUST appear together. A lone ChoCH or lone Sweep = 40% less edge.',
        '🔺 Harmonic Pattern':               'Wait for D-point completion + a reversal confirmation candle. Set SL just beyond X-point.',
        '🎯 ICT Silver Bullet':              'Only enter during 3-4 AM, 10-11 AM, or 2-3 PM EST kill zones for true ICT confluence.',
        '🚀 Trending (ADX>25)':              'Only trade when ADX > 25. Skip all choppy setups. Trend-trading beats reversals here.',
        '📅 With Daily Bias':                'Trade LONG only in BULLISH daily bias, SHORT in BEARISH. Filter all opposite-bias setups.',
        '👑 Golden + ChoCH':                 'Elite confluence — highest conviction. Consider sizing up 1.5× on these setups.',
        '🔲 Breaker Block OB':               'Enter on the re-test of the breaker. Wait for price to return to the OB zone, not at breakout.',
        '💥 Volume Breakout':                'Enter ONLY at the breakout candle close, NOT before. Volume spike alone without close is a trap.',
        '↩️ RSI Divergence':                  'Wait for price to make a new high/low while RSI diverges. Enter on the first reversal candle.',
    };
    const bestTip = STRATEGY_TIPS[strategies[0]?.label] || 'Focus on the top-ranked setup. Require full confluence before entering any trade.';

    return `
╔══════════════════════════════╗
║   📊 *BATCH BACKTEST RESULTS*  ║
╚══════════════════════════════╝

🪙 *${coinName}/USDT*  ⏱️ *${tf.toUpperCase()}*  📅 Last 30 Days
📦 Chunks processed: *${chunksOk}/${NUM_CHUNKS} × 5 days*  (Memory-Safe ✅)

━━━━━━━━━━━━━━━━━━━━━━━
📈 *OVERALL PERFORMANCE*
━━━━━━━━━━━━━━━━━━━━━━━
🔍 Trades Simulated: *${total}*  (Long: ${longT}  |  Short: ${shortT})

${wrEmoji} *Win Rate: ${wr}%*
   ✅ Wins: ${wins}   |   ❌ Losses: ${losses}

📈 Net P&L: *${netR}R*
💰 Profit Factor: *${pf}*   →   ${pfGrade}
💸 Gross Win: +${grossW.toFixed(2)}R   |   Gross Loss: -${grossL.toFixed(2)}R
📉 Max Drawdown: ${maxDD.toFixed(2)}R   |   🔴 Max Consec. Losses: ${maxConsec}

━━━━━━━━━━━━━━━━━━━━━━━
🧠 *AI STRATEGY ANALYSIS*
━━━━━━━━━━━━━━━━━━━━━━━
*Market Regime Breakdown:*
   🚀 Trending (ADX > 25): *${trendWR}%* WR  (${trendTrades.length} trades)
   ↔️ Ranging  (ADX < 20): *${rangeWR}%* WR  (${rangeTrades.length} trades)

*Daily Bias Alignment:*
   📅 With Bias:    *${biasWR}%* WR  (${withBias.length} trades)
   ⚠️ Counter Bias: *${antiWR}%* WR  (${againstBias.length} trades)

━━━━━━━━━━━━━━━━━━━━━━━
🏆 *BEST STRATEGIES FOUND*
━━━━━━━━━━━━━━━━━━━━━━━
${topBlock}

━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *SETUPS TO AVOID*
━━━━━━━━━━━━━━━━━━━━━━━
${worstBlock}

━━━━━━━━━━━━━━━━━━━━━━━
💡 *BEST STRATEGY: ${strategies[0]?.label || 'N/A'}*
━━━━━━━━━━━━━━━━━━━━━━━
→ *${strategies[0]?.wr.toFixed(1) || 0}%* Win Rate on ${coinName}/USDT ${tf.toUpperCase()}
→ *${strategies[0]?.wins || 0}W / ${strategies[0]?.losses || 0}L* in last 30 days
→ Net: *${strategies[0]?.pnlR !== undefined ? ((strategies[0].pnlR >= 0 ? '+' : '') + strategies[0].pnlR.toFixed(2)) : '0'}R*

💡 *Tip:* ${bestTip}

━━━━━━━━━━━━━━━━━━━━━━━
📋 *VERDICT*
━━━━━━━━━━━━━━━━━━━━━━━
${verdictEmoji} *${verdict}*

━━━━━━━━━━━━━━━━━━━━━━━
📊 *.scanbacktest ${tf}* — Compare across all coins
🗑️ *.clearbacktest ${coinName}* — Clear this result
⚠️ _30-day backtest reflects past conditions, not a guarantee of future results._`.trim();
}

// ══════════════════════════════════════════════════════════
//  CMD 1: .backtest — 30-Day AI Batch Backtest
// ══════════════════════════════════════════════════════════
cmd({
    pattern:  'backtest',
    alias:    ['bt', 'btest'],
    desc:     '30-Day AI Batch Backtest with Strategy Optimization (Memory-Safe)',
    category: 'crypto',
    react:    '⏪',
    filename: __filename,
}, async (conn, mek, m, { reply, args }) => {
    try {
        // ── Validation ──
        if (!args[0]) return await reply(
            `❌ *Please provide a coin and timeframe!*\n\n` +
            `*Usage:*  ${config.PREFIX}backtest BTC 15m\n` +
            `*Aliases:* .bt  |  .btest\n\n` +
            `*Valid timeframes:* 5m, 15m, 30m, 1h, 4h`
        );

        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';

        const tf = (args[1] || '15m').toLowerCase();
        const VALID_TFS = ['5m', '15m', '30m', '1h', '4h'];
        if (!VALID_TFS.includes(tf)) return await reply(
            `❌ *Invalid timeframe:* \`${tf}\`\n*Valid options:* ${VALID_TFS.join(', ')}`
        );

        await m.react('⏳');
        await reply(
            `⏳ *30-Day Batch Backtest Starting...*\n\n` +
            `🪙 Coin: *${coin.replace('USDT', '')}/USDT*\n` +
            `⏱️ Timeframe: *${tf.toUpperCase()}*\n` +
            `📦 Plan: *${NUM_CHUNKS} chunks × ${CHUNK_DAYS} days*  (one chunk in RAM at a time)\n` +
            `🧠 AI Optimizer: *17 strategy dimensions*\n` +
            `💾 Peak RAM usage: *~64 KB per chunk*  ✅\n\n` +
            `⏱️ _This will take ~30–60 seconds. Please wait..._`
        );

        const now    = Date.now();
        const allMeta = [];
        let chunksDone = 0;
        let fetchErrs  = 0;

        // ══════════════════════════════════════════════
        //  CHUNK LOOP — fetch → process → free memory
        //  chunk 0 = most recent 5 days
        //  chunk 5 = 25-30 days ago
        // ══════════════════════════════════════════════
        for (let chunk = 0; chunk < NUM_CHUNKS; chunk++) {
            const chunkEndMs   = now - chunk * CHUNK_DAYS * 24 * 3600 * 1000;
            const chunkStartMs = chunkEndMs - (CHUNK_DAYS + LOOKBACK_DAYS) * 24 * 3600 * 1000;

            let candles = null;   // explicitly null for GC clarity

            try {
                candles = await fetchKlinesRange(coin, tf, chunkStartMs, chunkEndMs);

                if (!candles || candles.length < 150) {
                    fetchErrs++;
                    continue;
                }

                const dailyBias    = computeDailyBias(candles);
                const tradeFromIdx = LOOKBACK_DAYS * CANDLES_PER_DAY_15M;   // skip 2-day warm-up
                const chunkMeta    = processChunk(candles, Math.max(200, tradeFromIdx), dailyBias);

                allMeta.push(...chunkMeta);
                chunksDone++;

            } catch (e) {
                console.error(`[backtest] chunk ${chunk} error:`, e.message);
                fetchErrs++;
            } finally {
                candles = null;   // ← CRITICAL: dereference → eligible for GC before next chunk
            }

            await sleep(INTER_CHUNK_MS);   // rate-limit safety + GC opportunity
        }

        // ── Guards ──
        if (chunksDone === 0) {
            return await reply(
                `❌ *Failed to fetch any data for ${coin}.*\n` +
                `Check the coin name and your internet connection, then try again.`
            );
        }

        if (allMeta.length < 5) {
            return await reply(
                `⚠️ *Insufficient trade signals for ${coin} on ${tf}.*\n\n` +
                `Only *${allMeta.length}* qualifying trades found in 30 days.\n` +
                `• Try a shorter timeframe (e.g. 5m or 15m)\n` +
                `• Or use a higher-volume coin (BTC, ETH, SOL)`
            );
        }

        // ── AI Strategy Analysis ──
        const strategies = analyzeStrategies(allMeta);

        if (!strategies.length) {
            return await reply(
                `⚠️ *Not enough trades per strategy to rank.*\n` +
                `Total trades: ${allMeta.length}  |  Chunks OK: ${chunksDone}\n` +
                `Try a more liquid coin or shorter timeframe.`
            );
        }

        // ── Persist top results to MongoDB ──
        try {
            await BacktestResult.deleteMany({ coin, tf });
            await BacktestResult.create({
                coin, tf,
                totalTrades: allMeta.length,
                chunksOk:   chunksDone,
                strategies: strategies.slice(0, 10).map(s => ({
                    label:  s.label,
                    wr:     parseFloat(s.wr.toFixed(1)),
                    trades: s.trades,
                    wins:   s.wins,
                    losses: s.losses,
                    pnlR:   parseFloat(s.pnlR.toFixed(2)),
                    pf:     parseFloat(s.pf.toFixed(2)),
                })),
                savedAt: new Date(),
            });
        } catch (dbErr) {
            console.error('[backtest] DB save error:', dbErr.message);
            // Non-fatal — continue to show results
        }

        // ── Build & Send ──
        const msg = buildOutputMessage(coin, tf, allMeta, strategies, chunksDone);
        await reply(msg);
        await m.react('✅');

    } catch (err) {
        console.error('[backtest] fatal error:', err);
        await reply(`❌ *Backtest Error:* ${err.message}`);
        await m.react('❌');
    }
});

// ══════════════════════════════════════════════════════════
//  CMD 2: .clearbacktest — Purge Stored Backtest Results
// ══════════════════════════════════════════════════════════
cmd({
    pattern:  'clearbacktest',
    alias:    ['cbt', 'btclear', 'clearbtest'],
    desc:     'Clear stored backtest results from the database',
    category: 'crypto',
    react:    '🗑️',
    filename: __filename,
}, async (conn, mek, m, { reply, args }) => {
    try {
        await m.react('⏳');

        // ── No args → list stored results ──
        if (!args[0]) {
            const all = await BacktestResult.find({}).sort({ savedAt: -1 }).limit(10).lean();

            if (!all.length) {
                return await reply(
                    `📭 *No backtest results stored yet.*\n\n` +
                    `Run *.backtest BTC 15m* to generate your first result!`
                );
            }

            const rows = all.map((r, i) => {
                const date     = new Date(r.savedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const topStrat = r.strategies?.[0];
                const coin     = r.coin.replace('USDT', '');
                return (
                    `*${i + 1}.* 🪙 *${coin}/USDT*  |  ⏱️ ${(r.tf || '?').toUpperCase()}  |  📅 ${date}\n` +
                    `   Trades: ${r.totalTrades}  |  Chunks: ${r.chunksOk}/${NUM_CHUNKS}\n` +
                    `   🏆 Top: *${topStrat?.label || 'N/A'}*  (${topStrat?.wr || 0}% WR)\n` +
                    `   🗑️ _.clearbacktest ${coin}_ to remove`
                );
            }).join('\n\n');

            return await reply(
                `╔══════════════════════════╗\n` +
                `║   🗂️ *STORED BACKTESTS*   ║\n` +
                `╚══════════════════════════╝\n\n` +
                `${rows}\n\n` +
                `━━━━━━━━━━━━━━━━━━━\n` +
                `🗑️ *.clearbacktest ALL* — Delete everything\n` +
                `🗑️ *.clearbacktest BTC* — Delete specific coin\n` +
                `🔄 *.backtest BTC 15m* — Re-run a fresh backtest`
            );
        }

        // ── ALL → delete everything ──
        if (args[0].toUpperCase() === 'ALL') {
            const count = await BacktestResult.countDocuments({});
            if (count === 0) {
                return await reply(`📭 *Nothing to clear.* The database is already empty.`);
            }
            await BacktestResult.deleteMany({});
            await m.react('✅');
            return await reply(
                `✅ *All Backtest Data Cleared!*\n\n` +
                `🗑️ Deleted: *${count}* stored records\n` +
                `📭 The database is now empty.\n\n` +
                `💡 Run *.backtest BTC 15m* to start fresh!`
            );
        }

        // ── Specific coin ──
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        const coinName = coin.replace('USDT', '');

        const docs = await BacktestResult.find({ coin }).lean();
        if (!docs.length) {
            return await reply(
                `📭 *No stored results for ${coinName}/USDT.*\n\n` +
                `Run *.backtest ${coinName}* first to generate data!`
            );
        }

        await BacktestResult.deleteMany({ coin });
        await m.react('✅');
        await reply(
            `✅ *Backtest Data Cleared!*\n\n` +
            `🪙 Coin: *${coinName}/USDT*\n` +
            `🗑️ Deleted: *${docs.length}* timeframe record(s)\n\n` +
            `💡 Run *.backtest ${coinName} 15m* to re-run!`
        );

    } catch (err) {
        console.error('[clearbacktest] error:', err);
        await reply(`❌ *Error:* ${err.message}`);
        await m.react('❌');
    }
});

// ══════════════════════════════════════════════════════════
//  CMD 3: .scanbacktest — Quick Multi-Coin Backtest Scan
//  Fast mode: no metadata, no AI analysis — just quick WR scan
// ══════════════════════════════════════════════════════════

/** Lightweight single-candle scorer (no metadata overhead) */
function fastScore(candles, i) {
    if (i < 200 || i >= candles.length) return null;

    const slice50  = candles.slice(i - 50,  i);
    const slice30  = candles.slice(i - 30,  i);
    const slice20  = candles.slice(i - 20,  i);
    const slice15  = candles.slice(i - 15,  i);
    const slice100 = candles.slice(i - 100, i);

    // ADX filter
    const adxData = safe(() => indicators.calculateADX(slice50));
    const adxVal  = adxData ? (adxData.value || 20) : 20;
    if (adxVal < MIN_ADX) return null;

    let L = 0, S = 0;
    const cp = parseFloat(candles[i - 1][4]);

    safe(() => {
        const ema200 = parseFloat(indicators.calculateEMA(candles.slice(i - 200, i), 200));
        if (cp > ema200) L += 0.5; else S += 0.5;
    });
    safe(() => {
        const m = smc.analyzeSMC(slice50);
        if (m.bullishOB) L++;
        if (m.bearishOB) S++;
        if (m.sweep && m.sweep.includes('Bullish')) L++;
        if (m.sweep && m.sweep.includes('Bearish')) S++;
        if (m.choch && m.choch.includes('Bullish')) L++;
        if (m.choch && m.choch.includes('Bearish')) S++;
    });
    safe(() => {
        const sweep = smc.checkLiquiditySweep(slice15);
        if (sweep.includes('Bullish')) L += 2;
        if (sweep.includes('Bearish')) S += 2;
    });
    safe(() => {
        const choch = smc.checkChoCH(slice20);
        if (choch.includes('Bullish')) L += 2;
        if (choch.includes('Bearish')) S += 2;
    });
    safe(() => {
        const rsi = indicators.calculateRSI(slice50, 14);
        if (rsi < 45) L++; if (rsi > 55) S++;
    });
    safe(() => {
        const macd = indicators.calculateMACD(slice50);
        if (macd.includes('Bullish')) L++;
        if (macd.includes('Bearish')) S++;
    });
    safe(() => {
        const harm = indicators.checkHarmonicPattern(slice100);
        if (harm.includes('Bullish')) L += 2;
        if (harm.includes('Bearish')) S += 2;
    });
    safe(() => {
        const bb = calculateBollingerBands(slice30);
        if (bb.isBull) L++; if (bb.isBear) S++;
    });
    safe(() => {
        const vb = indicators.checkVolumeBreakout(slice50);
        if (vb.includes('Bullish Breakout')) L++;
        if (vb.includes('Bearish Breakout')) S++;
    });

    const best = Math.max(L, S);
    if (best < MIN_SCORE) return null;

    const atr = safe(() => parseFloat(indicators.calculateATR(slice50)));
    if (!atr || atr <= 0) return null;

    return { isLong: L >= S, atr, entry: cp };
}

/** Fast backtest loop for one coin (no metadata storage) */
function runFastBacktest(candles) {
    let wins = 0, losses = 0;
    let netR = 0, cumR = 0, peak = 0, maxDD = 0;
    let i = 200;

    while (i < candles.length - 30) {
        const sc = fastScore(candles, i);
        if (!sc) { i++; continue; }

        const { isLong, atr, entry } = sc;
        const sl  = isLong ? entry - atr * 2 : entry + atr * 2;
        const tp  = isLong ? entry + atr * 3 : entry - atr * 3;   // simple TP (3R)

        let hit = false;
        for (let j = i; j < Math.min(candles.length, i + 150); j++) {
            const hi = parseFloat(candles[j][2]);
            const lo = parseFloat(candles[j][3]);
            if (isLong) {
                if (lo <= sl) { losses++; netR -= 2; cumR -= 2; hit = true; break; }
                if (hi >= tp) { wins++;  netR += 3; cumR += 3; hit = true; break; }
            } else {
                if (hi >= sl) { losses++; netR -= 2; cumR -= 2; hit = true; break; }
                if (lo <= tp) { wins++;  netR += 3; cumR += 3; hit = true; break; }
            }
        }
        if (!hit) { i += TRADE_SKIP; continue; }

        if (cumR > peak) peak = cumR;
        const dd = peak - cumR;
        if (dd > maxDD) maxDD = dd;
        i += TRADE_SKIP;
    }

    const total   = wins + losses;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    return { wins, losses, total, winRate, netR, maxDD };
}

cmd({
    pattern:  'scanbacktest',
    alias:    ['sbt', 'btscan', 'backtestscan'],
    desc:     'Quick backtest scan across top 20 coins',
    category: 'crypto',
    react:    '🔍',
    filename: __filename,
}, async (conn, mek, m, { reply, args }) => {
    try {
        await m.react('⏳');

        const tf = (args[0] || '15m').toLowerCase();
        const VALID_TFS = ['5m', '15m', '1h', '4h'];
        if (!VALID_TFS.includes(tf)) {
            return await reply(`❌ Invalid timeframe. Use: ${VALID_TFS.join(', ')}`);
        }

        await reply(
            `🔍 *Scanning Top 20 Coins...*\n\n` +
            `⏱️ Timeframe: *${tf.toUpperCase()}*  |  📅 Last 7 Days\n` +
            `⚙️ Mode: Fast WR scan (no AI analysis)\n` +
            `⏱️ _Estimated: ~60-90 seconds..._`
        );

        const TOP_COINS = [
            'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
            'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
            'LINKUSDT','LTCUSDT','UNIUSDT','ATOMUSDT','NEARUSDT',
            'APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT',
        ];

        const results = [];

        for (const coin of TOP_COINS) {
            let candles = null;
            try {
                candles = await fetchKlinesRange(coin, tf, Date.now() - 7 * 24 * 3600 * 1000, Date.now());
                if (!candles || candles.length < 300) continue;

                const { wins, losses, total, winRate, netR, maxDD } = runFastBacktest(candles);
                if (total < 3) continue;

                // Composite rank: balances win rate, net profit, and drawdown risk
                const composite = (winRate * (netR + 10)) / (1 + maxDD);
                results.push({
                    coin: coin.replace('USDT', ''),
                    winRate, total, wins, losses, netR, maxDD, composite,
                });
            } catch (_) {
                // Skip failed coins silently
            } finally {
                candles = null;
            }
            await sleep(250);   // light rate-limit between coins
        }

        if (!results.length) {
            return await reply(`❌ *No results returned.* Check your connection and try again.`);
        }

        results.sort((a, b) => b.composite - a.composite);

        const best5  = results.slice(0, 5);
        const worst3 = [...results].sort((a, b) => a.composite - b.composite).slice(0, 3);

        const avgWR   = (results.reduce((s, r) => s + r.winRate, 0) / results.length).toFixed(1);
        const tradeable = results.filter(r => r.winRate >= 55 && r.netR > 0).length;

        const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

        const bestBlock = best5.map((r, i) =>
            `${MEDALS[i]} *${r.coin}/USDT*\n` +
            `   📊 WR: *${r.winRate.toFixed(1)}%*  |  Net: *${r.netR >= 0 ? '+' : ''}${r.netR.toFixed(1)}R*  |  DD: ${r.maxDD.toFixed(1)}R\n` +
            `   Trades: ${r.total}  (${r.wins}W / ${r.losses}L)`
        ).join('\n\n');

        const worstBlock = worst3.map(r =>
            `⚠️ *${r.coin}/USDT*  —  ${r.winRate.toFixed(1)}% WR  (${r.total} trades)  ← Avoid`
        ).join('\n');

        const topCoin = best5[0];

        await reply(
            `╔═══════════════════════════════╗\n` +
            `║  🔍 *BACKTEST SCAN RESULTS*   ║\n` +
            `╚═══════════════════════════════╝\n\n` +
            `⏱️ Timeframe: *${tf.toUpperCase()}*  |  📅 Last 7 Days\n` +
            `📊 Coins Scanned: ${results.length}  |  ✅ Tradeable: ${tradeable}  |  Avg WR: ${avgWR}%\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🏆 *TOP 5 BEST PERFORMERS*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${bestBlock}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🚫 *AVOID THESE COINS*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${worstBlock}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 *Best Pick: *${topCoin?.coin}/USDT*\n` +
            `   → Run *.backtest ${topCoin?.coin} ${tf}* for full 30-day AI analysis!\n\n` +
            `🗑️ *.clearbacktest ALL* — Purge all stored results\n` +
            `⚠️ _Quick scan = 7-day data. Use *.backtest* for full 30-day + AI strategy breakdown._`
        );
        await m.react('✅');

    } catch (err) {
        console.error('[scanbacktest] error:', err);
        await reply(`❌ *Scan Error:* ${err.message}`);
        await m.react('❌');
    }
});
