/**
 * ═══════════════════════════════════════════════════════════════
 *  APEX-MD  ·  analyzer.js  ·  Institutional-Grade Adaptive Edition
 *  ─────────────────────────────────────────────────────────────
 *  v7 UPGRADES:
 *  1. 📅 DAILY BIAS & TOP-DOWN ANALYSIS
 *     • calculateDailyBias() — structure + EMA50 = BULLISH / BEARISH / RANGING
 *     • dailyBias exported in result object for scanner master-filter
 *
 *  2. 🏛️  ADX-BASED ADAPTIVE REGIME WEIGHTING
 *     • ADX > 25 (Trending)  → Massive bonus to SMC: OBs, ChoCH, Supertrend
 *     • ADX < 20 (Ranging)   → Massive bonus to Retail: RSI, BB, S/R, StochRSI
 *     • 20–25 (Transition)   → Normal weights preserved
 *
 *  3. ⭐ GOLDEN CONFLUENCE BONUS (+10 pts)
 *     • SMC signals (OBs + ChoCH + Sweep) AND
 *     • Retail signals (RSI + MACD + StochRSI) BOTH pointing same direction
 *     • Institutional-grade probability boost
 *
 *  All prior logic (5m Sniper, v5 World-Class, v6 Big-Profit) preserved.
 *  maxScore updated 70 → 90 to reflect new additions.
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const binance    = require('./binance');
const indicators = require('./indicators');
const smc        = require('./smartmoney');

// v4 precision tools
const {
    calculateStochRSI, calculateBollingerBands,
    detectMTFOrderBlocks, detectMTFOBs, validateEntryPoint,
    calculateSmartTPs, calculateSmartSL,
    checkMTFRSIConfluence, detectVolumeNodes, getSessionQuality,
    checkCandleCloseConfirmation, getKeyLevels, getEMARibbon,
    scanFairValueGaps, calculateSupertrend, calculateRVOL, checkMTFMACD,
} = require('./indicators');

// v5 world-class indicators
const {
    detectWyckoffPhase, detectBreakerBlocks, detectEqualHighsLows,
    checkPremiumDiscount, calculateWilliamsR, calculateIchimoku,
    getHeikinAshiTrend, approximateCVD, calculatePivotPoints,
    getPivotSignal, checkFibConfluence,
} = require('./indicators');

// v6 big-profit indicators
const {
    detectBBSqueezeExplosion, detectVolatilityExpansion, detectMarketMakerTrap,
    getWeeklyMonthlyTargets, detectCMEGap, check3TFAlignment,
} = require('./indicators');

// ══════════════════════════════════════════════════════════════
//  v7 NEW: DAILY BIAS CALCULATOR
//  Determines the macro directional bias from daily candles.
//
//  Logic:
//   • Structure scan: count consecutive HH+HL (bull) vs LH+LL (bear)
//     over the last 5 daily candles
//   • EMA50 position: price above = structural bull, below = structural bear
//   • Recent momentum: today's close vs 3 sessions ago
//   • Decision: 2 of 3 signals must agree → BULLISH / BEARISH / RANGING
//
//  Used by:
//   • analyzer  → dailyBias field in return object
//   • scanner   → Master filter (skip LONGs if BEARISH, skip SHORTs if BULLISH)
//   • papertrade → Saved to trade document for AI backtesting module
// ══════════════════════════════════════════════════════════════
function calculateDailyBias(candlesDaily) {
    if (!candlesDaily || candlesDaily.length < 5) {
        return {
            bias:    'RANGING',
            emoji:   '⚪',
            label:   'RANGING ⚪',
            detail:  'Insufficient daily data (< 5 candles)',
            ema50:   null,
            aboveEma: null,
            bullBars: 0,
            bearBars: 0,
        };
    }

    const n      = candlesDaily.length;
    const closes = candlesDaily.map(c => parseFloat(c[4]));
    const highs  = candlesDaily.map(c => parseFloat(c[2]));
    const lows   = candlesDaily.map(c => parseFloat(c[3]));
    const currentClose = closes[n - 1];

    // ── Daily EMA50 (fallback to all available bars if < 50) ──────
    const emaPeriod = Math.min(50, n);
    const ema50     = parseFloat(indicators.calculateEMA(candlesDaily.slice(-Math.max(emaPeriod, 5)), emaPeriod));
    const aboveEma  = currentClose > ema50;

    // ── Daily Structure over last 5 completed candles ─────────────
    // A valid bull bar = higher high AND higher low vs prior candle.
    // A valid bear bar = lower high AND lower low vs prior candle.
    const lookback = Math.min(5, n - 1);
    let bullBars = 0, bearBars = 0;
    for (let i = n - lookback; i < n; i++) {
        const isHH = highs[i]  > highs[i - 1];
        const isHL = lows[i]   > lows[i - 1];
        const isLH = highs[i]  < highs[i - 1];
        const isLL = lows[i]   < lows[i - 1];
        if (isHH && isHL) bullBars++;
        if (isLH && isLL) bearBars++;
    }

    // ── Recent momentum: today vs 3 sessions ago ─────────────────
    const recentMomentum = n >= 4 ? currentClose > closes[n - 4] : aboveEma;

    // ── Bias decision: majority of 3 signals must agree ──────────
    const bullSignals =
        (aboveEma          ? 1 : 0) +
        (bullBars >= 2     ? 1 : 0) +
        (recentMomentum    ? 1 : 0);
    const bearSignals =
        (!aboveEma         ? 1 : 0) +
        (bearBars >= 2     ? 1 : 0) +
        (!recentMomentum   ? 1 : 0);

    let bias, detail;
    if (bullSignals >= 2) {
        bias   = 'BULLISH';
        detail = `EMA50 $${ema50.toFixed(4)} | Bull bars: ${bullBars}/${lookback} | Momentum: ▲`;
    } else if (bearSignals >= 2) {
        bias   = 'BEARISH';
        detail = `EMA50 $${ema50.toFixed(4)} | Bear bars: ${bearBars}/${lookback} | Momentum: ▼`;
    } else {
        bias   = 'RANGING';
        detail = `Mixed: Bull ${bullSignals}/3 vs Bear ${bearSignals}/3 | EMA50 $${ema50.toFixed(4)}`;
    }

    const emoji = bias === 'BULLISH' ? '🟢' : bias === 'BEARISH' ? '🔴' : '⚪';
    return { bias, emoji, label: `${bias} ${emoji}`, detail, ema50, aboveEma, bullBars, bearBars };
}

// ══════════════════════════════════════════════════════════════
//  MTF TRADE CLASSIFICATION ENGINE  (unchanged from v6)
// ══════════════════════════════════════════════════════════════

function isPriceAtOB(ob, price, tolerance = 0.003) {
    if (!ob) return false;
    const bottom = parseFloat(ob.bottom);
    const top    = parseFloat(ob.top);
    return price >= bottom * (1 - tolerance) && price <= top * (1 + tolerance);
}

function classifyTrade({
    currentPrice, direction,
    ob4H, ob1H, ob15m, ob5m,
    choch5m, choch15m, sweep5m, sweep15m,
}) {
    const isLong   = direction === 'LONG';
    const dirOB4H  = isLong ? ob4H.bullish  : ob4H.bearish;
    const dirOB1H  = isLong ? ob1H.bullish  : ob1H.bearish;
    const dirOB15m = isLong ? ob15m.bullish : ob15m.bearish;
    const dirOB5m  = isLong ? ob5m.bullish  : ob5m.bearish;

    const at4HOB  = isPriceAtOB(dirOB4H,  currentPrice);
    const at1HOB  = isPriceAtOB(dirOB1H,  currentPrice);
    const at15mOB = isPriceAtOB(dirOB15m, currentPrice);

    const choch5mAligned  = isLong ? choch5m.includes('Bullish')  : choch5m.includes('Bearish');
    const sweep5mAligned  = isLong ? sweep5m.includes('Bullish')  : sweep5m.includes('Bearish');
    const ob5mAligned     = !!dirOB5m;
    const confirmed5m     = choch5mAligned || sweep5mAligned || ob5mAligned;

    const choch15mAligned = isLong ? choch15m.includes('Bullish') : choch15m.includes('Bearish');
    const sweep15mAligned = isLong ? sweep15m.includes('Bullish') : sweep15m.includes('Bearish');
    const ob15mAligned    = !!dirOB15m;
    const confirmed15m    = choch15mAligned || sweep15mAligned || ob15mAligned;

    function buildConfirmStr(tf, chochA, sweepA, obA) {
        const parts = [];
        if (chochA) parts.push(`${tf} ChoCH ✅`);
        if (sweepA) parts.push(`${tf} Sweep ✅`);
        if (obA)    parts.push(`${tf} OB ✅`);
        return parts.length ? parts.join(' + ') : `${tf} Pending ⏳`;
    }

    if (at4HOB && (confirmed5m || confirmed15m)) {
        const confStr = confirmed5m
            ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned)
            : buildConfirmStr('15m', choch15mAligned, sweep15mAligned, ob15mAligned);
        return {
            label:    '📅 SWING TRADE (Sniper Entry)',
            htfZone:  `4H OB: $${dirOB4H.bottom} – $${dirOB4H.top}`,
            confirmTF: confStr, holdTime: '2–7 Days',
            riskNote: 'Hold for full TP3. Wide SL. Scale in on 5m dips.', emoji: '📅',
        };
    }
    if (at1HOB && (confirmed15m || confirmed5m)) {
        const confStr = confirmed5m
            ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned)
            : buildConfirmStr('15m', choch15mAligned, sweep15mAligned, ob15mAligned);
        return {
            label:    '🌅 INTRADAY TRADE (Sniper)',
            htfZone:  `1H OB: $${dirOB1H.bottom} – $${dirOB1H.top}`,
            confirmTF: confStr, holdTime: '4–24 Hours',
            riskNote: 'Target TP1/TP2. Move SL to break-even at TP1.', emoji: '🌅',
        };
    }
    if (at15mOB && confirmed5m) {
        const confStr = buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned);
        return {
            label:    '⚡ HIGH-PROB SCALP',
            htfZone:  `15m OB: $${dirOB15m.bottom} – $${dirOB15m.top}`,
            confirmTF: confStr, holdTime: '30–240 Minutes',
            riskNote: 'Tight SL. Target TP1 only. Exit quickly.', emoji: '⚡',
        };
    }
    return {
        label:    '📊 STANDARD SETUP',
        htfZone:  'No HTF OB Confluence',
        confirmTF: confirmed5m ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned) : 'Score-Based Entry',
        holdTime: 'Flexible',
        riskNote: 'Follow 14-Factor score. Wait for cleaner structure.', emoji: '📊',
    };
}

// ══════════════════════════════════════════════════════════════
//  MAIN ANALYSIS ENGINE  —  run14FactorAnalysis()
//  v7: Daily Bias + Adaptive Regime Weighting + Golden Confluence
// ══════════════════════════════════════════════════════════════

async function run14FactorAnalysis(coin, timeframe = '15m') {

    // ── 1. Data Fetching ─────────────────────────────────────────
    const [currentCandles, candles5m, candles1H, candles4H, candlesDaily] = await Promise.all([
        binance.getKlineDataFromCache(coin, timeframe, 500),
        binance.getKlineDataFromCache(coin, '5m',     500),
        binance.getKlineDataFromCache(coin, '1h',     60),
        binance.getKlineDataFromCache(coin, '4h',     80),
        binance.getKlineDataFromCache(coin, '1d',     30).catch(() => null),
    ]);

    const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]);
    const priceStr     = currentPrice.toFixed(4);

    // ── v7: Daily Bias (Top-Down Analysis) ───────────────────────
    // Computed early — used in scoring AND exported for scanner filter.
    const dailyBias = calculateDailyBias(candlesDaily);

    // ── 2. Core Indicators ───────────────────────────────────────
    const ema200 = parseFloat(indicators.calculateEMA(currentCandles, 200));
    const ema50  = parseFloat(indicators.calculateEMA(currentCandles.slice(-100), 50));
    const ema1H  = parseFloat(indicators.calculateEMA(candles1H, 50));
    const ema4H  = parseFloat(indicators.calculateEMA(candles4H, 50));

    const trend1H   = parseFloat(candles1H[candles1H.length - 1][4]) > ema1H ? 'Bullish 🟢' : 'Bearish 🔴';
    const trend4H   = parseFloat(candles4H[candles4H.length - 1][4]) > ema4H ? 'Bullish 🟢' : 'Bearish 🔴';
    const mainTrend = currentPrice > ema200 ? 'Bullish 🟢' : 'Bearish 🔴';
    const direction = mainTrend.includes('Bullish') ? 'LONG' : 'SHORT';

    // ── 3. Market State & ADX ─────────────────────────────────────
    const adxData = indicators.calculateADX(currentCandles.slice(-50));
    const isHTFAligned =
        (trend1H.includes('Bullish') && trend4H.includes('Bullish')) ||
        (trend1H.includes('Bearish') && trend4H.includes('Bearish'));

    let marketState  = 'TRENDING 🚀';
    let isTrueChoppy = false;
    if (!adxData.isStrong) {
        if (isHTFAligned) marketState = `CONSOLIDATION ⏳ (${trend4H.includes('Bullish') ? 'Bull Flag' : 'Bear Flag'})`;
        else              { marketState = 'TRUE CHOPPY ⚖️ (Grid Mode Active)'; isTrueChoppy = true; }
    }

    // ── 4. Advanced Metrics & SMC ─────────────────────────────────
    const rsi             = indicators.calculateRSI(currentCandles.slice(-50), 14);
    const atr             = indicators.calculateATR(currentCandles.slice(-50));
    const atrVal          = parseFloat(atr);
    const macd            = indicators.calculateMACD(currentCandles.slice(-50));
    const vwap            = indicators.calculateVWAP(currentCandles);
    const poc             = indicators.calculatePOC(currentCandles.slice(-50));
    const pattern         = indicators.checkCandlePattern(currentCandles.slice(-10));
    const volBreak        = indicators.checkVolumeBreakout(currentCandles.slice(-50));
    const divergence      = indicators.checkDivergence(currentCandles.slice(-50));
    const harmonicPattern = indicators.checkHarmonicPattern(currentCandles.slice(-100));
    const ictSilverBullet = indicators.checkICTSilverBullet(currentCandles.slice(-10));
    const marketSMC       = smc.analyzeSMC(currentCandles.slice(-50));
    const mtf5m           = indicators.confirmEntry5m(candles5m, direction);

    const liquiditySweep = smc.checkLiquiditySweep(currentCandles.slice(-15));
    const choch          = smc.checkChoCH(currentCandles.slice(-20));
    const mtfOBsExtra    = detectMTFOBs(currentCandles.slice(-15));

    const stochRSI  = calculateStochRSI(currentCandles.slice(-60));
    const bbands    = calculateBollingerBands(currentCandles.slice(-30));
    const mtfOB     = detectMTFOrderBlocks(currentCandles.slice(-30), candles1H.slice(-20));

    const mtfRSI     = checkMTFRSIConfluence(currentCandles.slice(-50), candles1H.slice(-50));
    const volNodes   = detectVolumeNodes(currentCandles.slice(-100));
    const session    = getSessionQuality();
    const candleConf = checkCandleCloseConfirmation(currentCandles.slice(-5), direction, null);

    const keyLevels  = getKeyLevels(currentCandles.slice(-100));
    const emaRibbon  = getEMARibbon(currentCandles);
    const fvgData    = scanFairValueGaps(currentCandles.slice(-50));

    const supertrend = calculateSupertrend(currentCandles.slice(-60));
    const rvol       = calculateRVOL(currentCandles.slice(-30));
    const mtfMACD    = checkMTFMACD(currentCandles.slice(-60), candles1H.slice(-60));

    // v5 world-class
    const wyckoff    = detectWyckoffPhase(currentCandles.slice(-55));
    const breakers   = detectBreakerBlocks(currentCandles.slice(-40));
    const equalHL    = detectEqualHighsLows(currentCandles.slice(-60));
    const pdZone     = checkPremiumDiscount(currentCandles.slice(-60), direction);
    const williamsR  = calculateWilliamsR(currentCandles.slice(-20));
    const ichimoku   = calculateIchimoku(currentCandles.slice(-60));
    const heikinAshi = getHeikinAshiTrend(currentCandles.slice(-15));
    const cvd        = approximateCVD(currentCandles.slice(-30));
    const pivots     = calculatePivotPoints(candlesDaily);
    const pivotSignal = getPivotSignal(currentPrice, pivots, direction);
    const fibConf    = checkFibConfluence(currentCandles.slice(-60), direction);

    // ── 4b. 5m Sniper Layer ──────────────────────────────────────
    const ob5m         = detectMTFOBs(candles5m.slice(-20));
    const choch5m      = smc.checkChoCH(candles5m.slice(-25));
    const sweep5m      = smc.checkLiquiditySweep(candles5m.slice(-15));
    const fvg5m        = scanFairValueGaps(candles5m.slice(-60));
    const smc5m        = smc.analyzeSMC(candles5m.slice(-50));
    const ema21_5m     = parseFloat(indicators.calculateEMA(candles5m.slice(-30), 21));
    const price5mClose = parseFloat(candles5m[candles5m.length - 1][4]);
    const trend5m      = price5mClose > ema21_5m ? 'Bullish 🟢' : 'Bearish 🔴';

    // ── 4c. HTF OB Detection ─────────────────────────────────────
    const ob4H  = detectMTFOBs(candles4H.slice(-20));
    const ob1H  = detectMTFOBs(candles1H.slice(-20));
    const ob15m = detectMTFOBs(currentCandles.slice(-20));

    const choch15m = smc.checkChoCH(currentCandles.slice(-20));
    const sweep15m = smc.checkLiquiditySweep(currentCandles.slice(-15));

    // v6 big-profit
    const bbSqueeze    = detectBBSqueezeExplosion(currentCandles.slice(-60));
    const volExpansion = detectVolatilityExpansion(currentCandles.slice(-70));
    const mmTrap       = detectMarketMakerTrap(currentCandles.slice(-25));
    const weeklyTgts   = getWeeklyMonthlyTargets(candlesDaily, direction, currentPrice);
    const cmeGap       = detectCMEGap(candlesDaily, currentPrice);
    const tf3Align     = check3TFAlignment(trend5m, mainTrend, trend1H);

    // Daily EMA gate (legacy field, kept for backward compat)
    const dailyClose   = candlesDaily && candlesDaily.length >= 2
        ? parseFloat(candlesDaily[candlesDaily.length - 1][4])
        : currentPrice;
    const dailyEma50   = candlesDaily && candlesDaily.length >= 50
        ? parseFloat(indicators.calculateEMA(candlesDaily, 50))
        : null;
    const dailyTrend   = dailyEma50
        ? (dailyClose > dailyEma50 ? 'Bullish 🟢' : 'Bearish 🔴')
        : 'Unknown ⚪';
    const dailyAligned = dailyTrend !== 'Unknown ⚪'
        && ((direction === 'LONG'  && dailyTrend.includes('Bullish'))
        ||  (direction === 'SHORT' && dailyTrend.includes('Bearish')));

    // ── 4e. MTF Trade Classification ─────────────────────────────
    const tradeCategory = classifyTrade({
        currentPrice, direction,
        ob4H, ob1H, ob15m, ob5m,
        choch5m, choch15m, sweep5m, sweep15m,
    });

    // ── 5. Entry & Order Types ───────────────────────────────────
    const vwapMatch   = vwap.match(/\$([0-9.]+)/);
    const vwapPrice   = vwapMatch ? parseFloat(vwapMatch[1]) : 0;
    const obForDir    = direction === 'LONG' ? marketSMC.bullishOB : marketSMC.bearishOB;

    const bestEntry       = smc.selectBestEntry(priceStr, obForDir, marketSMC.fib618, poc, vwapPrice, direction, atrVal, harmonicPattern);
    const entryValidation = validateEntryPoint(bestEntry.price, currentPrice, direction);
    const confirmation    = smc.checkOBConfirmation(currentCandles.slice(-5), obForDir, direction);
    const orderSuggestion = smc.getOrderTypeSuggestion(bestEntry.price, currentPrice, direction);

    // ── 6. Smart SL / TP ─────────────────────────────────────────
    const entryPrice  = parseFloat(bestEntry.price);
    const smartSLData = calculateSmartSL(entryPrice, direction, currentCandles.slice(-30), obForDir, atrVal);
    const sl          = parseFloat(smartSLData.sl);
    const slLabel     = smartSLData.slLabel;
    const smartTPData = calculateSmartTPs(entryPrice, sl, direction, currentCandles.slice(-50));
    const tp1         = parseFloat(smartTPData.tp1);
    const tp2         = parseFloat(smartTPData.tp2);
    const tp3         = parseFloat(smartTPData.tp3);

    // ══════════════════════════════════════════════════════════════
    //  7. SCORING ENGINE — Base + v5 + v6 + 5m Sniper
    //     (All prior weights preserved exactly — additions below)
    // ══════════════════════════════════════════════════════════════
    let longScore = 0, shortScore = 0, longR = [], shortR = [];

    // ── Trend Confluence ──
    if (trend4H.includes('Bullish') && trend1H.includes('Bullish'))  { longScore++;  longR.push('MTF Bull'); }
    if (trend4H.includes('Bearish') && trend1H.includes('Bearish'))  { shortScore++; shortR.push('MTF Bear'); }
    if (currentPrice > ema200 && Math.abs(currentPrice - ema50) / ema50 < 0.003) { longScore++;  longR.push('EMA Pullback'); }
    if (currentPrice < ema200 && Math.abs(currentPrice - ema50) / ema50 < 0.003) { shortScore++; shortR.push('EMA Pullback'); }

    // ── SMC Order Blocks ──
    if (marketSMC.bullishOB) { longScore++;  longR.push('Bull OB'); }
    if (marketSMC.bearishOB) { shortScore++; shortR.push('Bear OB'); }

    // ── RSI ──
    if (rsi < 45) { longScore++;  longR.push('RSI Oversold'); }
    if (rsi > 55) { shortScore++; shortR.push('RSI Overbought'); }

    // ── VWAP ──
    if (vwap.includes('🟢')) { longScore++;  longR.push('Above VWAP'); }
    if (vwap.includes('🔴')) { shortScore++; shortR.push('Below VWAP'); }

    // ── Candle Pattern ──
    if (pattern.includes('🟢')) { longScore++;  longR.push(pattern.split(' ')[0]); }
    if (pattern.includes('🔴')) { shortScore++; shortR.push(pattern.split(' ')[0]); }

    // ── Volume ──
    if (volBreak.includes('Bullish Breakout')) { longScore++;  longR.push('Vol Spike'); }
    if (volBreak.includes('Bearish Breakout')) { shortScore++; shortR.push('Vol Spike'); }

    // ── Divergence ──
    if (divergence.includes('Bullish')) { longScore++;  longR.push('Divergence'); }
    if (divergence.includes('Bearish')) { shortScore++; shortR.push('Divergence'); }

    // ── MACD ──
    if (macd.includes('Bullish')) { longScore++;  longR.push('MACD Bull'); }
    if (macd.includes('Bearish')) { shortScore++; shortR.push('MACD Bear'); }

    // ── Sweep / ChoCH ──
    if (marketSMC.sweep.includes('Bullish') || marketSMC.choch.includes('Bullish')) { longScore++;  longR.push('Sweep/ChoCH'); }
    if (marketSMC.sweep.includes('Bearish') || marketSMC.choch.includes('Bearish')) { shortScore++; shortR.push('Sweep/ChoCH'); }

    // ── OB Confirmation ──
    if (confirmation.confirmed) {
        if (direction === 'LONG') { longScore++;  longR.push('OB Touch ✅'); }
        else                      { shortScore++; shortR.push('OB Touch ✅'); }
    }

    // ── 5m Alignment ──
    if (mtf5m.confirmed) {
        if (direction === 'LONG') { longScore++;  longR.push('5m Aligned ✅'); }
        else                      { shortScore++; shortR.push('5m Aligned ✅'); }
    }

    // ── Harmonic ──
    if (harmonicPattern.includes('Bullish')) { longScore++;  longR.push(harmonicPattern.split(' ')[1]); }
    if (harmonicPattern.includes('Bearish')) { shortScore++; shortR.push(harmonicPattern.split(' ')[1]); }

    // ── ICT Silver Bullet ──
    if (ictSilverBullet.includes('Bullish')) { longScore++;  longR.push('ICT Time 🎯'); }
    if (ictSilverBullet.includes('Bearish')) { shortScore++; shortR.push('ICT Time 🎯'); }

    // ── StochRSI ──
    if (stochRSI.isBull) { longScore++;  longR.push(`StochRSI ${stochRSI.signal}`); }
    if (stochRSI.isBear) { shortScore++; shortR.push(`StochRSI ${stochRSI.signal}`); }

    // ── Bollinger Bands ──
    if (bbands.isBull)  { longScore++;  longR.push('BB Lower Zone'); }
    if (bbands.isBear)  { shortScore++; shortR.push('BB Upper Zone'); }
    if (bbands.squeeze) { longScore += 0.5; shortScore += 0.5; }

    // ── MTF OB Confluence ──
    if (mtfOB.confluenceZone) {
        if (mtfOB.confluenceZone.type === 'BULLISH') { longScore += 2;  longR.push('MTF OB Confluence 🔥'); }
        if (mtfOB.confluenceZone.type === 'BEARISH') { shortScore += 2; shortR.push('MTF OB Confluence 🔥'); }
    }

    // ── EMA Ribbon ──
    if (emaRibbon) {
        if (emaRibbon.signal === 'STRONG_BULL')   { longScore  += 2; longR.push('EMA Ribbon Bull 🟢🟢'); }
        if (emaRibbon.signal === 'STRONG_BEAR')   { shortScore += 2; shortR.push('EMA Ribbon Bear 🔴🔴'); }
        if (emaRibbon.signal === 'BULL_PULLBACK') { longScore++;     longR.push('EMA21 Pullback 🟡'); }
        if (emaRibbon.signal === 'BEAR_PULLBACK') { shortScore++;    shortR.push('EMA21 Pullback 🟡'); }
    }

    // ── MTF RSI ──
    if (mtfRSI.isBull) { longScore  += mtfRSI.signal === 'STRONG_BULL' ? 2 : 1; longR.push('MTF RSI Bull'); }
    if (mtfRSI.isBear) { shortScore += mtfRSI.signal === 'STRONG_BEAR' ? 2 : 1; shortR.push('MTF RSI Bear'); }

    // ── HVN ──
    if (volNodes.nearHVN) {
        if (direction === 'LONG') { longScore++;  longR.push('HVN Zone 🔥'); }
        else                      { shortScore++; shortR.push('HVN Zone 🔥'); }
    }

    // ── Session Quality ──
    if (session.isBestSession) {
        if (direction === 'LONG') { longScore  += 0.5; longR.push(`${session.emoji} ${session.session}`); }
        else                      { shortScore += 0.5; shortR.push(`${session.emoji} ${session.session}`); }
    }

    // ── Candle Close Confirmation ──
    if (candleConf.confirmed) {
        if (direction === 'LONG') { longScore++;  longR.push('Candle Close ✅'); }
        else                      { shortScore++; shortR.push('Candle Close ✅'); }
    }

    // ── Liquidity Sweep ──
    if (liquiditySweep.includes('Bullish')) { longScore  += 2; longR.push('Liq Sweep 🟢'); }
    if (liquiditySweep.includes('Bearish')) { shortScore += 2; shortR.push('Liq Sweep 🔴'); }

    // ── ChoCH ──
    if (choch.includes('Bullish')) { longScore  += 2; longR.push('ChoCH 🔄🟢'); }
    if (choch.includes('Bearish')) { shortScore += 2; shortR.push('ChoCH 🔄🔴'); }

    // ── Supertrend ──
    if (supertrend.justFlipUp)   { longScore  += 2; longR.push('Supertrend Flip 🟢🟢'); }
    else if (supertrend.isBull)  { longScore++;     longR.push('Supertrend Bull 🟢'); }
    if (supertrend.justFlipDown) { shortScore += 2; shortR.push('Supertrend Flip 🔴🔴'); }
    else if (supertrend.isBear)  { shortScore++;    shortR.push('Supertrend Bear 🔴'); }

    // ── RVOL ──
    if (rvol.signal === 'EXTREME' || rvol.signal === 'HIGH') {
        longScore += 0.5; shortScore += 0.5;
        longR.push('RVOL High 🔥'); shortR.push('RVOL High 🔥');
    }

    // ── MTF MACD ──
    if (mtfMACD.signal === 'STRONG_BULL') { longScore  += 2; longR.push('MTF MACD Bull 🟢🟢'); }
    if (mtfMACD.signal === 'STRONG_BEAR') { shortScore += 2; shortR.push('MTF MACD Bear 🔴🔴'); }

    // ── Extra MTF OBs ──
    if (mtfOBsExtra.bullish && direction === 'LONG')  { longScore++;  longR.push('Short OB 🟢'); }
    if (mtfOBsExtra.bearish && direction === 'SHORT') { shortScore++; shortR.push('Short OB 🔴'); }

    // ── v5 World-Class ──
    if      (wyckoff.phase === 'SPRING')       { longScore  += 3; longR.push('Wyckoff Spring 🌱🌱🌱'); }
    else if (wyckoff.phase === 'MARKUP')       { longScore++;     longR.push('Wyckoff Markup 📈'); }
    else if (wyckoff.phase === 'ACCUMULATION') { longScore  += 0.5; longR.push('Wyckoff Accum 🔄'); }
    if      (wyckoff.phase === 'UTAD')         { shortScore += 3; shortR.push('Wyckoff UTAD ⚡⚡⚡'); }
    else if (wyckoff.phase === 'MARKDOWN')     { shortScore++;    shortR.push('Wyckoff Markdown 📉'); }
    else if (wyckoff.phase === 'DISTRIBUTION') { shortScore += 0.5; shortR.push('Wyckoff Dist 🔄'); }

    if (breakers.bullishBreaker && direction === 'LONG')  { longScore  += 2; longR.push('Bull Breaker 🔲'); }
    if (breakers.bearishBreaker && direction === 'SHORT') { shortScore += 2; shortR.push('Bear Breaker 🔲'); }

    if (equalHL.eql && direction === 'LONG')  { longScore++;  longR.push('EQL Below 💧'); }
    if (equalHL.eqh && direction === 'SHORT') { shortScore++; shortR.push('EQH Above 💧'); }

    if (pdZone.zone === 'OTE') {
        longScore += 2; shortScore += 2;
        longR.push('OTE Zone 🎯'); shortR.push('OTE Zone 🎯');
    } else if (pdZone.tradeMatch) {
        if (direction === 'LONG') { longScore++;  longR.push('Discount Zone 🟢'); }
        else                      { shortScore++; shortR.push('Premium Zone 🔴'); }
    } else if (!pdZone.tradeMatch && pdZone.zone !== 'EQUILIBRIUM' && pdZone.zone !== 'UNKNOWN') {
        if (direction === 'LONG')  longScore  = Math.max(0, longScore  - 1);
        if (direction === 'SHORT') shortScore = Math.max(0, shortScore - 1);
    }

    if (fibConf.hasConfluence) {
        if (direction === 'LONG') { longScore  += 2; longR.push(`Fib Confluence ${fibConf.count}× 🔢`); }
        else                      { shortScore += 2; shortR.push(`Fib Confluence ${fibConf.count}× 🔢`); }
    }

    if (pivotSignal.isBull) { longScore++;  longR.push(`Pivot ${pivotSignal.nearLevel?.name || ''} Support 📌`); }
    if (pivotSignal.isBear) { shortScore++; shortR.push(`Pivot ${pivotSignal.nearLevel?.name || ''} Resist 📌`); }

    if      (ichimoku.signal === 'STRONG_BULL') { longScore  += 2; longR.push('Ichimoku Bull Cross ☁️🚀'); }
    else if (ichimoku.signal === 'BULL')        { longScore++;     longR.push('Ichimoku Bull ☁️🟢'); }
    else if (ichimoku.signal === 'MILD_BULL')   { longScore  += 0.5; }
    if      (ichimoku.signal === 'STRONG_BEAR') { shortScore += 2; shortR.push('Ichimoku Bear Cross ☁️📉'); }
    else if (ichimoku.signal === 'BEAR')        { shortScore++;    shortR.push('Ichimoku Bear ☁️🔴'); }
    else if (ichimoku.signal === 'MILD_BEAR')   { shortScore += 0.5; }
    if (ichimoku.inCloud) {
        longScore  = Math.max(0, longScore  - 1);
        shortScore = Math.max(0, shortScore - 1);
    }

    if      (cvd.bullDiv)           { longScore  += 2; longR.push('CVD Bull Div 📊🚀'); }
    else if (cvd.trend === 'BULL')  { longScore++;     longR.push('CVD Rising 📊🟢'); }
    if      (cvd.bearDiv)           { shortScore += 2; shortR.push('CVD Bear Div 📊⚠️'); }
    else if (cvd.trend === 'BEAR')  { shortScore++;    shortR.push('CVD Falling 📊🔴'); }

    if (heikinAshi.isStrong && heikinAshi.isBull) { longScore++;  longR.push(`HA ${heikinAshi.consecutive}× Bull 🕯️`); }
    if (heikinAshi.isStrong && heikinAshi.isBear) { shortScore++; shortR.push(`HA ${heikinAshi.consecutive}× Bear 🕯️`); }

    if (williamsR.isBull) { longScore++;  longR.push(`W%R ${williamsR.value} 🟢`); }
    if (williamsR.isBear) { shortScore++; shortR.push(`W%R ${williamsR.value} 🔴`); }

    // ── v6 Big-Profit ──
    if (bbSqueeze.exploding) {
        if (bbSqueeze.explosionDir === 'BULL') { longScore  += 3; longR.push('BB Explosion 💥🟢'); }
        else                                   { shortScore += 3; shortR.push('BB Explosion 💥🔴'); }
    } else if (bbSqueeze.isSqueezing && bbSqueeze.squeezeDuration >= 3) {
        longScore += 1; shortScore += 1;
        longR.push('BB Squeeze ⚡'); shortR.push('BB Squeeze ⚡');
    }

    if (volExpansion.justStarted) {
        if (direction === 'LONG') { longScore  += 3; longR.push('Trend Start! ADX⚡'); }
        else                      { shortScore += 3; shortR.push('Trend Start! ADX⚡'); }
    } else if (volExpansion.expanding) {
        if (direction === 'LONG') { longScore  += 1; longR.push('Volatility Expanding 📈'); }
        else                      { shortScore += 1; shortR.push('Volatility Expanding 📉'); }
    }

    if (mmTrap.bearTrap && direction === 'LONG')  { longScore  += 3; longR.push('Bear Trap! LONG 🪤'); }
    if (mmTrap.bullTrap && direction === 'SHORT') { shortScore += 3; shortR.push('Bull Trap! SHORT 🪤'); }

    if (tf3Align.aligned) {
        if (tf3Align.allBull) { longScore  += 2; longR.push('3TF Aligned 🟢🟢🟢'); }
        if (tf3Align.allBear) { shortScore += 2; shortR.push('3TF Aligned 🔴🔴🔴'); }
    }

    if (dailyAligned) {
        if (direction === 'LONG') { longScore  += 2; longR.push('Daily Trend ✅'); }
        else                      { shortScore += 2; shortR.push('Daily Trend ✅'); }
    } else if (dailyTrend !== 'Unknown ⚪') {
        if (direction === 'LONG')  longScore  = Math.max(0, longScore  - 2);
        if (direction === 'SHORT') shortScore = Math.max(0, shortScore - 2);
    }

    if (cmeGap.hasGap && !cmeGap.filled) {
        const gapDir = cmeGap.gapAbove ? 'LONG' : 'SHORT';
        if (gapDir === direction) {
            if (direction === 'LONG') { longScore++;  longR.push('CME Gap Target 🎯'); }
            else                      { shortScore++; shortR.push('CME Gap Target 🎯'); }
        }
    }

    if (weeklyTgts && weeklyTgts.nearTarget) {
        const tpDist = Math.abs(tp2 - currentPrice) / currentPrice;
        const wkDist = Math.abs(weeklyTgts.nearTarget - currentPrice) / currentPrice;
        if (wkDist <= tpDist * 1.5) {
            if (direction === 'LONG') { longScore++;  longR.push('Weekly Level TP 🗓️'); }
            else                      { shortScore++; shortR.push('Weekly Level TP 🗓️'); }
        }
    }

    // ── 5m Sniper Layer ──
    if (choch5m.includes('Bullish')) { longScore  += 2; longR.push('5m ChoCH 🔄🟢⚡'); }
    if (choch5m.includes('Bearish')) { shortScore += 2; shortR.push('5m ChoCH 🔄🔴⚡'); }
    if (sweep5m.includes('Bullish')) { longScore  += 2; longR.push('5m Liq Sweep 🟢⚡'); }
    if (sweep5m.includes('Bearish')) { shortScore += 2; shortR.push('5m Liq Sweep 🔴⚡'); }
    if (ob5m.bullish && direction === 'LONG')  { longScore++;  longR.push('5m OB 🟢'); }
    if (ob5m.bearish && direction === 'SHORT') { shortScore++; shortR.push('5m OB 🔴'); }
    if (trend5m.includes('Bullish') && direction === 'LONG')  { longScore  += 0.5; longR.push('5m EMA Trend 🟢'); }
    if (trend5m.includes('Bearish') && direction === 'SHORT') { shortScore += 0.5; shortR.push('5m EMA Trend 🔴'); }
    if (tradeCategory.label.includes('SWING')) {
        if (direction === 'LONG') { longScore++;  longR.push('4H OB Sniper 📅'); }
        else                      { shortScore++; shortR.push('4H OB Sniper 📅'); }
    }
    if (tradeCategory.label.includes('SCALP')) {
        if (direction === 'LONG') { longScore++;  longR.push('15m OB Scalp ⚡'); }
        else                      { shortScore++; shortR.push('15m OB Scalp ⚡'); }
    }

    // ══════════════════════════════════════════════════════════════
    //  v7 UPGRADE 1: ADX-BASED ADAPTIVE REGIME WEIGHTING
    //  ─────────────────────────────────────────────────────────────
    //  These are ADDITIVE bonuses on top of base scores.
    //  They do not remove or overwrite any prior calculation.
    //
    //  Trending Regime (ADX > 25):
    //    SMC signals get massive extra weight — OBs and ChoCH are
    //    highly reliable in trending markets. RSI extremes are NOT
    //    penalized but receive no extra weight (RSI can stay extreme
    //    for the entire trend — it's a lagging tool when trending).
    //
    //  Ranging Regime (ADX < 20):
    //    Retail indicators get massive extra weight — RSI extremes,
    //    BB mean-reversion, and key S/R levels dominate ranging action.
    //    SMC OBs get no extra weight (fakeouts are common in ranges).
    // ══════════════════════════════════════════════════════════════
    const adxNum         = parseFloat(adxData.value) || 0;
    const isAdxTrending  = adxNum > 25;
    const isAdxRanging   = adxNum < 20;
    const regimeLabel    = isAdxTrending ? `TRENDING (ADX ${adxNum.toFixed(1)})` : isAdxRanging ? `RANGING (ADX ${adxNum.toFixed(1)})` : `TRANSITION (ADX ${adxNum.toFixed(1)})`;

    if (isAdxTrending) {
        // ── Trend Regime: Reward SMC Signals ──────────────────────
        if (marketSMC.bullishOB)                                { longScore  += 2; longR.push(`📈 OB×Trend`); }
        if (marketSMC.bearishOB)                                { shortScore += 2; shortR.push(`📈 OB×Trend`); }
        if (choch.includes('Bullish'))                          { longScore  += 2; longR.push(`📈 ChoCH×Trend`); }
        if (choch.includes('Bearish'))                          { shortScore += 2; shortR.push(`📈 ChoCH×Trend`); }
        if (supertrend.isBull || supertrend.justFlipUp)         { longScore  += 2; longR.push(`📈 ST×Trend`); }
        if (supertrend.isBear || supertrend.justFlipDown)       { shortScore += 2; shortR.push(`📈 ST×Trend`); }
        if (liquiditySweep.includes('Bullish'))                 { longScore  += 1; longR.push(`📈 Sweep×Trend`); }
        if (liquiditySweep.includes('Bearish'))                 { shortScore += 1; shortR.push(`📈 Sweep×Trend`); }
        if (mtfMACD.signal === 'STRONG_BULL')                   { longScore  += 1; }
        if (mtfMACD.signal === 'STRONG_BEAR')                   { shortScore += 1; }
        if (tf3Align.allBull)                                   { longScore  += 1; longR.push(`📈 3TF×Trend`); }
        if (tf3Align.allBear)                                   { shortScore += 1; shortR.push(`📈 3TF×Trend`); }

    } else if (isAdxRanging) {
        // ── Range Regime: Reward Mean-Reversion Indicators ────────
        if (rsi < 35)                                           { longScore  += 2; longR.push(`🎯 RSI×Range Ext`); }
        else if (rsi < 42)                                      { longScore  += 1; longR.push(`🎯 RSI×Range`); }
        if (rsi > 65)                                           { shortScore += 2; shortR.push(`🎯 RSI×Range Ext`); }
        else if (rsi > 58)                                      { shortScore += 1; shortR.push(`🎯 RSI×Range`); }
        if (bbands.isBull)                                      { longScore  += 2; longR.push(`🎯 BB×Range`); }
        if (bbands.isBear)                                      { shortScore += 2; shortR.push(`🎯 BB×Range`); }
        if (bbands.squeeze)                                     { longScore  += 1; shortScore += 1; }
        if (stochRSI.isBull)                                    { longScore  += 1; longR.push(`🎯 StochRSI×Range`); }
        if (stochRSI.isBear)                                    { shortScore += 1; shortR.push(`🎯 StochRSI×Range`); }
        if (pivotSignal.isBull)                                 { longScore  += 1; longR.push(`🎯 Pivot×Range`); }
        if (pivotSignal.isBear)                                 { shortScore += 1; shortR.push(`🎯 Pivot×Range`); }
        if (williamsR.isBull)                                   { longScore  += 1; longR.push(`🎯 W%R×Range`); }
        if (williamsR.isBear)                                   { shortScore += 1; shortR.push(`🎯 W%R×Range`); }
        if (divergence.includes('Bullish'))                     { longScore  += 1; longR.push(`🎯 Div×Range`); }
        if (divergence.includes('Bearish'))                     { shortScore += 1; shortR.push(`🎯 Div×Range`); }
    }

    // ══════════════════════════════════════════════════════════════
    //  v7 UPGRADE 2: ⭐ GOLDEN CONFLUENCE BONUS (+10 points)
    //  ─────────────────────────────────────────────────────────────
    //  Awarded ONLY when BOTH of the following are true simultaneously:
    //
    //  SMC Group confirmed:
    //    At least one of: Bull/Bear OB | ChoCH | Liquidity Sweep | MTF OB Zone
    //
    //  Retail Group confirmed:
    //    RSI in directional zone (< 45 long / > 55 short) AND
    //    at least one of: MACD | StochRSI | Bollinger Bands
    //
    //  This represents the highest-probability institutional setup:
    //  smart money accumulated/distributed (SMC) while retail
    //  indicators also confirm — the probability of follow-through
    //  is dramatically higher when both groups agree.
    // ══════════════════════════════════════════════════════════════
    const smcBullActive = !!(
        marketSMC.bullishOB ||
        choch.includes('Bullish') ||
        liquiditySweep.includes('Bullish') ||
        (mtfOB.confluenceZone && mtfOB.confluenceZone.type === 'BULLISH')
    );
    const smcBearActive = !!(
        marketSMC.bearishOB ||
        choch.includes('Bearish') ||
        liquiditySweep.includes('Bearish') ||
        (mtfOB.confluenceZone && mtfOB.confluenceZone.type === 'BEARISH')
    );
    const retailBullActive = rsi < 45 && !!(
        macd.includes('Bullish') || stochRSI.isBull || bbands.isBull
    );
    const retailBearActive = rsi > 55 && !!(
        macd.includes('Bearish') || stochRSI.isBear || bbands.isBear
    );

    const goldenConfluenceLong  = smcBullActive  && retailBullActive;
    const goldenConfluenceShort = smcBearActive  && retailBearActive;

    if (goldenConfluenceLong) {
        longScore  += 10;
        longR.push('⭐ GOLDEN CONFLUENCE (SMC+Retail) ⭐');
    }
    if (goldenConfluenceShort) {
        shortScore += 10;
        shortR.push('⭐ GOLDEN CONFLUENCE (SMC+Retail) ⭐');
    }

    // ══════════════════════════════════════════════════════════════
    //  8. SMART DIRECTION OVERRIDE + FINAL SCORING
    // ══════════════════════════════════════════════════════════════
    const smartDir      = longScore >= shortScore ? 'LONG' : 'SHORT';
    const scoreDiff     = Math.abs(longScore - shortScore);
    const bestDirection = scoreDiff >= 2 ? smartDir : direction;
    const bestScore     = bestDirection === 'LONG' ? Math.floor(longScore) : Math.floor(shortScore);
    const bestReasons   = (bestDirection === 'LONG' ? longR : shortR).join(', ') || 'None';

    // ── Confirmation Gate ────────────────────────────────────────
    const isL = bestDirection === 'LONG';
    const confChecks = {
        htfAligned:   (trend1H.includes('Bullish') && trend4H.includes('Bullish')) || (trend1H.includes('Bearish') && trend4H.includes('Bearish')),
        chochPrimary: choch.includes(isL ? 'Bullish' : 'Bearish'),
        sweepPrimary: liquiditySweep.includes(isL ? 'Bullish' : 'Bearish'),
        choch5mConf:  choch5m.includes(isL ? 'Bullish' : 'Bearish'),
        sweep5mConf:  sweep5m.includes(isL ? 'Bullish' : 'Bearish'),
        volumeConf:   volBreak.includes(isL ? 'Bullish' : 'Bearish') || rvol.signal === 'HIGH' || rvol.signal === 'EXTREME',
        dailyGate:    dailyAligned,
        wyckoffConf:  (isL && (wyckoff.phase === 'SPRING' || wyckoff.phase === 'MARKUP')) || (!isL && (wyckoff.phase === 'UTAD' || wyckoff.phase === 'MARKDOWN')),
        ichimokuConf: (isL && (ichimoku.signal === 'STRONG_BULL' || ichimoku.signal === 'BULL')) || (!isL && (ichimoku.signal === 'STRONG_BEAR' || ichimoku.signal === 'BEAR')),
        supTrendConf: (isL && (supertrend.isBull || supertrend.justFlipUp)) || (!isL && (supertrend.isBear || supertrend.justFlipDown)),
        fibZoneConf:  fibConf.hasConfluence,
        bbExplosion:  bbSqueeze.exploding && ((isL && bbSqueeze.explosionDir === 'BULL') || (!isL && bbSqueeze.explosionDir === 'BEAR')),
        mmTrapConf:   (isL && mmTrap.bearTrap) || (!isL && mmTrap.bullTrap),
        goldenConf:   isL ? goldenConfluenceLong : goldenConfluenceShort,   // v7: Golden Confluence as conf check
    };
    const confScore = Object.values(confChecks).filter(Boolean).length;
    const confGate  = confScore >= 2;

    // ── 9. Return Master Object ──────────────────────────────────
    return {
        // Core price & trend
        priceStr, currentPrice, currentCandles,
        direction: bestDirection,
        emaDirection: direction,
        mainTrend, trend1H, trend4H, marketState, isTrueChoppy,

        // Primary-TF indicators
        adxData, rsi, vwap, macd, harmonicPattern, ictSilverBullet,
        marketSMC, mtf5m,

        // Entry zone & order management
        bestEntry, confirmation, orderSuggestion,
        entryPrice: entryPrice.toFixed(4),
        sl:      parseFloat(sl).toFixed(4),
        slLabel: slLabel || 'ATR',
        tp1: parseFloat(tp1).toFixed(4), tp1Label: smartTPData.tp1Label,
        tp2: parseFloat(tp2).toFixed(4), tp2Label: smartTPData.tp2Label,
        tp3: parseFloat(tp3).toFixed(4), tp3Label: smartTPData.tp3Label,

        // v4 precision
        stochRSI, bbands, mtfOB, mtfOBsExtra,
        liquiditySweep, choch, entryValidation,

        // Scoring — v7: maxScore 90 (base 70 + regime ~10 + golden confluence 10)
        score: bestScore, maxScore: 90, reasons: bestReasons,
        longScore: Math.floor(longScore),
        shortScore: Math.floor(shortScore),

        // Confirmation Gate
        confScore, confGate, confChecks,

        // v4 confirmation
        mtfRSI, volNodes, session, candleConf,
        keyLevels, emaRibbon, fvgData,
        supertrend, rvol, mtfMACD,

        // v5 world-class
        wyckoff, breakers, equalHL, pdZone,
        williamsR, ichimoku, heikinAshi, cvd,
        pivots, pivotSignal, fibConf,

        // 5m Sniper Layer
        tradeCategory,
        ob5m, choch5m, sweep5m, fvg5m, smc5m, trend5m, ema21_5m,
        ob4H, ob1H, ob15m, choch15m, sweep15m,

        // v6 Big-Profit
        bbSqueeze, volExpansion, mmTrap, weeklyTgts, cmeGap, tf3Align,
        dailyTrend, dailyAligned,

        // ══════════════════════════════════════════════════════════
        // v7 NEW FIELDS
        // ══════════════════════════════════════════════════════════
        dailyBias,              // { bias, emoji, label, detail, ema50, aboveEma, bullBars, bearBars }
        regimeLabel,            // 'TRENDING (ADX 28.3)' / 'RANGING (ADX 14.1)' / 'TRANSITION'
        goldenConfluenceLong,   // true = SMC + Retail both confirmed LONG
        goldenConfluenceShort,  // true = SMC + Retail both confirmed SHORT
        goldenConfluence: isL ? goldenConfluenceLong : goldenConfluenceShort,
    };
}

module.exports = { run14FactorAnalysis };
