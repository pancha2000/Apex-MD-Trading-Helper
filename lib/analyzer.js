/**
 * ═══════════════════════════════════════════════════════════════
 *  APEX-MD  ·  analyzer.js  ·  Sniper Entry & MTF-OB Edition
 *  ─────────────────────────────────────────────────────────────
 *  • 5m timeframe now live-streamed (500 candles, WS cache)
 *  • Full 5m SMC layer: OB, FVG, ChoCH, Liquidity Sweep
 *  • MTF Trade Classification:
 *      📅 SWING TRADE  — 4H OB zone + 5m/15m ChoCH/OB confirmation
 *      🌅 INTRADAY     — 1H OB zone + 15m/5m ChoCH/OB confirmation
 *      ⚡ HIGH-PROB SCALP — 15m OB zone + strict 5m confirmation
 *  • 5m OB/ChoCH/Sweep feed into the 14-Factor scoring system
 *  • All existing indicators, risk management, and return shape preserved
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
//  MTF TRADE CLASSIFICATION ENGINE
//  Determines trade type from OB-zone confluence across 4H, 1H,
//  15m, and 5m — replacing the old static timeframe-based label.
// ══════════════════════════════════════════════════════════════

/**
 * Checks if the current price is sitting inside (or very near)
 * an Order Block zone, allowing a 0.3% tolerance buffer.
 *
 * @param {Object|null} ob          - OB object with .bottom and .top strings
 * @param {number}      price       - current market price
 * @param {number}      tolerance   - fraction tolerance (default 0.3%)
 * @returns {boolean}
 */
function isPriceAtOB(ob, price, tolerance = 0.003) {
    if (!ob) return false;
    const bottom = parseFloat(ob.bottom);
    const top    = parseFloat(ob.top);
    // Widen the zone slightly above/below so pullbacks to the zone edge qualify
    return price >= bottom * (1 - tolerance) && price <= top * (1 + tolerance);
}

/**
 * Core classification function.
 *
 * Priority waterfall (highest to lowest):
 *   1. 📅 SWING TRADE    — price at 4H OB + 5m or 15m confirmation
 *   2. 🌅 INTRADAY TRADE — price at 1H OB + 15m or 5m confirmation
 *   3. ⚡ HIGH-PROB SCALP — price at 15m OB + strict 5m-only confirmation
 *   4. 📊 STANDARD SETUP — score-based, no OB confluence met
 *
 * @param {object} params
 * @param {number}      params.currentPrice
 * @param {string}      params.direction      'LONG' or 'SHORT'
 * @param {object}      params.ob4H           detectMTFOBs result for 4H candles
 * @param {object}      params.ob1H           detectMTFOBs result for 1H candles
 * @param {object}      params.ob15m          detectMTFOBs result for 15m candles
 * @param {object}      params.ob5m           detectMTFOBs result for 5m candles
 * @param {string}      params.choch5m        smc.checkChoCH result on 5m
 * @param {string}      params.choch15m       smc.checkChoCH result on 15m
 * @param {string}      params.sweep5m        smc.checkLiquiditySweep result on 5m
 * @param {string}      params.sweep15m       smc.checkLiquiditySweep result on 15m
 * @returns {object}    { label, htfZone, confirmTF, holdTime, riskNote, emoji }
 */
function classifyTrade({
    currentPrice,
    direction,
    ob4H,
    ob1H,
    ob15m,
    ob5m,
    choch5m,
    choch15m,
    sweep5m,
    sweep15m,
}) {
    const isLong  = direction === 'LONG';

    // ── Select directional OB for each timeframe ──────────────────
    const dirOB4H  = isLong ? ob4H.bullish  : ob4H.bearish;
    const dirOB1H  = isLong ? ob1H.bullish  : ob1H.bearish;
    const dirOB15m = isLong ? ob15m.bullish : ob15m.bearish;
    const dirOB5m  = isLong ? ob5m.bullish  : ob5m.bearish;

    // ── HTF zone presence flags ───────────────────────────────────
    const at4HOB  = isPriceAtOB(dirOB4H,  currentPrice);
    const at1HOB  = isPriceAtOB(dirOB1H,  currentPrice);
    const at15mOB = isPriceAtOB(dirOB15m, currentPrice);

    // ── Lower-TF confirmation flags (5m) ─────────────────────────
    // A 5m confirmation is valid when ANY of the following is true:
    //   • 5m ChoCH aligns with trade direction (structure reversal)
    //   • 5m Liquidity Sweep aligns (institutional entry)
    //   • A 5m OB in the direction exists (microstructure support/resist)
    const choch5mAligned  = isLong ? choch5m.includes('Bullish')  : choch5m.includes('Bearish');
    const sweep5mAligned  = isLong ? sweep5m.includes('Bullish')  : sweep5m.includes('Bearish');
    const ob5mAligned     = !!dirOB5m;
    const confirmed5m     = choch5mAligned || sweep5mAligned || ob5mAligned;

    // ── Lower-TF confirmation flags (15m) ────────────────────────
    const choch15mAligned = isLong ? choch15m.includes('Bullish') : choch15m.includes('Bearish');
    const sweep15mAligned = isLong ? sweep15m.includes('Bullish') : sweep15m.includes('Bearish');
    const ob15mAligned    = !!dirOB15m;
    const confirmed15m    = choch15mAligned || sweep15mAligned || ob15mAligned;

    // ── Build human-readable confirmation detail string ───────────
    function buildConfirmStr(tf, chochAligned, sweepAligned, obAligned) {
        const parts = [];
        if (chochAligned) parts.push(`${tf} ChoCH ✅`);
        if (sweepAligned) parts.push(`${tf} Sweep ✅`);
        if (obAligned)    parts.push(`${tf} OB ✅`);
        return parts.length ? parts.join(' + ') : `${tf} Pending ⏳`;
    }

    // ════════════════════════════════════════════════════════════
    //  1. 📅 SWING TRADE — price at 4H OB + any LTF confirmation
    // ════════════════════════════════════════════════════════════
    if (at4HOB && (confirmed5m || confirmed15m)) {
        const confStr = confirmed5m
            ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned)
            : buildConfirmStr('15m', choch15mAligned, sweep15mAligned, ob15mAligned);
        return {
            label:    '📅 SWING TRADE (Sniper Entry)',
            htfZone:  `4H OB: $${dirOB4H.bottom} – $${dirOB4H.top}`,
            confirmTF: confStr,
            holdTime: '2–7 Days',
            riskNote: 'Hold for full TP3. Wide SL. Scale in on 5m dips.',
            emoji:    '📅',
        };
    }

    // ════════════════════════════════════════════════════════════
    //  2. 🌅 INTRADAY TRADE — price at 1H OB + 15m or 5m confirm
    // ════════════════════════════════════════════════════════════
    if (at1HOB && (confirmed15m || confirmed5m)) {
        const confStr = confirmed5m
            ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned)
            : buildConfirmStr('15m', choch15mAligned, sweep15mAligned, ob15mAligned);
        return {
            label:    '🌅 INTRADAY TRADE (Sniper)',
            htfZone:  `1H OB: $${dirOB1H.bottom} – $${dirOB1H.top}`,
            confirmTF: confStr,
            holdTime: '4–24 Hours',
            riskNote: 'Target TP1/TP2. Move SL to break-even at TP1.',
            emoji:    '🌅',
        };
    }

    // ════════════════════════════════════════════════════════════
    //  3. ⚡ HIGH-PROB SCALP — price at 15m OB + strict 5m confirm
    // ════════════════════════════════════════════════════════════
    if (at15mOB && confirmed5m) {
        const confStr = buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned);
        return {
            label:    '⚡ HIGH-PROB SCALP',
            htfZone:  `15m OB: $${dirOB15m.bottom} – $${dirOB15m.top}`,
            confirmTF: confStr,
            holdTime: '30–240 Minutes',
            riskNote: 'Tight SL. Target TP1 only. Exit quickly.',
            emoji:    '⚡',
        };
    }

    // ════════════════════════════════════════════════════════════
    //  4. 📊 STANDARD SETUP — no OB confluence zone met
    // ════════════════════════════════════════════════════════════
    return {
        label:    '📊 STANDARD SETUP',
        htfZone:  'No HTF OB Confluence',
        confirmTF: confirmed5m ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned) : 'Score-Based Entry',
        holdTime: 'Flexible',
        riskNote: 'Follow 14-Factor score. Wait for cleaner structure.',
        emoji:    '📊',
    };
}

// ══════════════════════════════════════════════════════════════
//  14-FACTOR ULTIMATE MARKET ANALYZER ENGINE
//  (Shareable module for Future, Spot, and Scanner)
//
//  DATA SOURCE: All kline data served from the in-memory
//  WebSocket cache via binance.getKlineDataFromCache().
//  Falls back to a one-time REST call automatically on cache miss.
// ══════════════════════════════════════════════════════════════

async function run14FactorAnalysis(coin, timeframe = '15m') {

    // ── 1. Data Fetching (from live WS cache — zero REST polling) ─
    // candles5m now requests 500 candles from the live 5m WS stream
    const [currentCandles, candles5m, candles1H, candles4H, candlesDaily] = await Promise.all([
        binance.getKlineDataFromCache(coin, timeframe, 500),
        binance.getKlineDataFromCache(coin, '5m',     500),
        binance.getKlineDataFromCache(coin, '1h',     60),
        binance.getKlineDataFromCache(coin, '4h',     80),
        binance.getKlineDataFromCache(coin, '1d',     30).catch(() => null),  // ← 30 daily for weekly targets
    ]);

    const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]);
    const priceStr     = currentPrice.toFixed(4);

    // ── 2. Core Indicators ───────────────────────────────────────
    const ema200 = parseFloat(indicators.calculateEMA(currentCandles, 200));
    const ema50  = parseFloat(indicators.calculateEMA(currentCandles.slice(-100), 50));
    const ema1H  = parseFloat(indicators.calculateEMA(candles1H, 50));
    const ema4H  = parseFloat(indicators.calculateEMA(candles4H, 50));

    const trend1H   = parseFloat(candles1H[candles1H.length - 1][4]) > ema1H ? 'Bullish 🟢' : 'Bearish 🔴';
    const trend4H   = parseFloat(candles4H[candles4H.length - 1][4]) > ema4H ? 'Bullish 🟢' : 'Bearish 🔴';
    const mainTrend = currentPrice > ema200 ? 'Bullish 🟢' : 'Bearish 🔴';
    const direction = mainTrend.includes('Bullish') ? 'LONG' : 'SHORT';

    // ── 3. Market State & Choppy Detection ──────────────────────
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

    // ── 4. Advanced Metrics & SMC (15m / primary TF) ─────────────
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

    // v4 precision — primary TF liquidity sweep + ChoCH
    const liquiditySweep = smc.checkLiquiditySweep(currentCandles.slice(-15));
    const choch          = smc.checkChoCH(currentCandles.slice(-20));
    const mtfOBsExtra    = detectMTFOBs(currentCandles.slice(-15));

    // v4 precision indicators
    const stochRSI  = calculateStochRSI(currentCandles.slice(-60));
    const bbands    = calculateBollingerBands(currentCandles.slice(-30));
    const mtfOB     = detectMTFOrderBlocks(currentCandles.slice(-30), candles1H.slice(-20));

    // v4 advanced entry confirmation
    const mtfRSI     = checkMTFRSIConfluence(currentCandles.slice(-50), candles1H.slice(-50));
    const volNodes   = detectVolumeNodes(currentCandles.slice(-100));
    const session    = getSessionQuality();
    const candleConf = checkCandleCloseConfirmation(currentCandles.slice(-5), direction, null);

    // v4 Key S/R, EMA Ribbon, FVG (primary TF)
    const keyLevels  = getKeyLevels(currentCandles.slice(-100));
    const emaRibbon  = getEMARibbon(currentCandles);
    const fvgData    = scanFairValueGaps(currentCandles.slice(-50));

    // v4 additions
    const supertrend = calculateSupertrend(currentCandles.slice(-60));
    const rvol       = calculateRVOL(currentCandles.slice(-30));
    const mtfMACD    = checkMTFMACD(currentCandles.slice(-60), candles1H.slice(-60));

    // v5 world-class indicators
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

    // ── v6 BIG PROFIT INDICATORS ─────────────────────────────────
    const bbSqueeze    = detectBBSqueezeExplosion(currentCandles.slice(-60));
    const volExpansion = detectVolatilityExpansion(currentCandles.slice(-70));
    const mmTrap       = detectMarketMakerTrap(currentCandles.slice(-25));
    const weeklyTgts   = getWeeklyMonthlyTargets(candlesDaily, direction, currentPrice);
    const cmeGap       = detectCMEGap(candlesDaily, currentPrice);
    const tf3Align     = check3TFAlignment(trend5m, mainTrend, trend1H);
    // HTF Daily trend gate — is the daily chart aligned with our trade direction?
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

    // ── 4b. 5m SNIPER LAYER ──────────────────────────────────────
    // Full SMC analysis on the 5m timeframe using 500 live-streamed candles.
    // These feed into: (a) MTF trade classification, (b) scoring bonuses.

    // 5m Order Blocks (short-term institutional zones)
    const ob5m         = detectMTFOBs(candles5m.slice(-20));

    // 5m Change of Character — the trigger for sniper entries
    const choch5m      = smc.checkChoCH(candles5m.slice(-25));

    // 5m Liquidity Sweep — confirms institutional involvement on 5m
    const sweep5m      = smc.checkLiquiditySweep(candles5m.slice(-15));

    // 5m Fair Value Gaps — short-term imbalance zones for TP targeting
    const fvg5m        = scanFairValueGaps(candles5m.slice(-60));

    // 5m SMC full picture (support, resistance, FVG, OB display strings)
    const smc5m        = smc.analyzeSMC(candles5m.slice(-50));

    // 5m EMA (21-period) for microstructure trend context
    const ema21_5m     = parseFloat(indicators.calculateEMA(candles5m.slice(-30), 21));
    const price5mClose = parseFloat(candles5m[candles5m.length - 1][4]);
    const trend5m      = price5mClose > ema21_5m ? 'Bullish 🟢' : 'Bearish 🔴';

    // ── 4c. HTF OB Detection for Classification ──────────────────
    // Detect 4H and 1H OBs independently for zone-presence checks.
    // These are separate from the scoring-focused mtfOB (which overlaps 15m+1H).
    const ob4H  = detectMTFOBs(candles4H.slice(-20));   // 4H OBs for swing zone
    const ob1H  = detectMTFOBs(candles1H.slice(-20));   // 1H OBs for intraday zone
    const ob15m = detectMTFOBs(currentCandles.slice(-20)); // 15m OBs for scalp zone

    // Also extract 15m ChoCH/Sweep for classification confirmation
    const choch15m = smc.checkChoCH(currentCandles.slice(-20));
    const sweep15m = smc.checkLiquiditySweep(currentCandles.slice(-15));

    // ── 4d. MTF TRADE CLASSIFICATION ─────────────────────────────
    const tradeCategory = classifyTrade({
        currentPrice,
        direction,
        ob4H,
        ob1H,
        ob15m,
        ob5m,
        choch5m,
        choch15m,
        sweep5m,
        sweep15m,
    });

    // ── 5. Entry & Order Types ───────────────────────────────────
    const vwapMatch   = vwap.match(/\$([0-9.]+)/);
    const vwapPrice   = vwapMatch ? parseFloat(vwapMatch[1]) : 0;
    const obForDir    = direction === 'LONG' ? marketSMC.bullishOB : marketSMC.bearishOB;

    const bestEntry       = smc.selectBestEntry(priceStr, obForDir, marketSMC.fib618, poc, vwapPrice, direction, atrVal, harmonicPattern);
    const entryValidation = validateEntryPoint(bestEntry.price, currentPrice, direction);
    const confirmation    = smc.checkOBConfirmation(currentCandles.slice(-5), obForDir, direction);
    const orderSuggestion = smc.getOrderTypeSuggestion(bestEntry.price, currentPrice, direction);

    // ── 6. Smart SL / TP Calculation ────────────────────────────
    const entryPrice  = parseFloat(bestEntry.price);
    const smartSLData = calculateSmartSL(entryPrice, direction, currentCandles.slice(-30), obForDir, atrVal);
    const sl          = parseFloat(smartSLData.sl);
    const slLabel     = smartSLData.slLabel;
    const smartTPData = calculateSmartTPs(entryPrice, sl, direction, currentCandles.slice(-50));
    const tp1         = parseFloat(smartTPData.tp1);
    const tp2         = parseFloat(smartTPData.tp2);
    const tp3         = parseFloat(smartTPData.tp3);

    // ── 7. 14-FACTOR + 5m SNIPER SCORING SYSTEM ─────────────────
    let longScore = 0, shortScore = 0, longR = [], shortR = [];

    // ── Trend confluence ──
    if (trend4H.includes('Bullish') && trend1H.includes('Bullish'))  { longScore++;  longR.push('MTF Bull'); }
    if (trend4H.includes('Bearish') && trend1H.includes('Bearish'))  { shortScore++; shortR.push('MTF Bear'); }
    if (currentPrice > ema200 && Math.abs(currentPrice - ema50) / ema50 < 0.003) { longScore++;  longR.push('EMA Pullback'); }
    if (currentPrice < ema200 && Math.abs(currentPrice - ema50) / ema50 < 0.003) { shortScore++; shortR.push('EMA Pullback'); }

    // ── SMC Order Blocks (primary TF) ──
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

    // ── Sweep / ChoCH (primary TF) ──
    if (marketSMC.sweep.includes('Bullish') || marketSMC.choch.includes('Bullish')) { longScore++;  longR.push('Sweep/ChoCH'); }
    if (marketSMC.sweep.includes('Bearish') || marketSMC.choch.includes('Bearish')) { shortScore++; shortR.push('Sweep/ChoCH'); }

    // ── OB Confirmation ──
    if (confirmation.confirmed) {
        if (direction === 'LONG') { longScore++;  longR.push('OB Touch ✅'); }
        else                      { shortScore++; shortR.push('OB Touch ✅'); }
    }

    // ── 5m Alignment (existing confirmEntry5m check) ──
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

    // ── MTF OB Confluence (15m + 1H overlap) ──
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

    // ── Liquidity Sweep — primary TF ──
    if (liquiditySweep.includes('Bullish')) { longScore  += 2; longR.push('Liq Sweep 🟢'); }
    if (liquiditySweep.includes('Bearish')) { shortScore += 2; shortR.push('Liq Sweep 🔴'); }

    // ── ChoCH — primary TF ──
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

    // ── Extra MTF OBs (primary TF short-term) ──
    if (mtfOBsExtra.bullish && direction === 'LONG')  { longScore++;  longR.push('Short OB 🟢'); }
    if (mtfOBsExtra.bearish && direction === 'SHORT') { shortScore++; shortR.push('Short OB 🔴'); }

    // ════════════════════════════════════════════
    // v5 WORLD-CLASS SCORING FACTORS
    // ════════════════════════════════════════════

    // Wyckoff Phase
    if      (wyckoff.phase === 'SPRING')       { longScore  += 3; longR.push('Wyckoff Spring 🌱🌱🌱'); }
    else if (wyckoff.phase === 'MARKUP')       { longScore++;     longR.push('Wyckoff Markup 📈'); }
    else if (wyckoff.phase === 'ACCUMULATION') { longScore  += 0.5; longR.push('Wyckoff Accum 🔄'); }
    if      (wyckoff.phase === 'UTAD')         { shortScore += 3; shortR.push('Wyckoff UTAD ⚡⚡⚡'); }
    else if (wyckoff.phase === 'MARKDOWN')     { shortScore++;    shortR.push('Wyckoff Markdown 📉'); }
    else if (wyckoff.phase === 'DISTRIBUTION') { shortScore += 0.5; shortR.push('Wyckoff Dist 🔄'); }

    // Breaker Blocks
    if (breakers.bullishBreaker && direction === 'LONG')  { longScore  += 2; longR.push('Bull Breaker 🔲'); }
    if (breakers.bearishBreaker && direction === 'SHORT') { shortScore += 2; shortR.push('Bear Breaker 🔲'); }

    // EQH / EQL
    if (equalHL.eql && direction === 'LONG')  { longScore++;  longR.push('EQL Below 💧'); }
    if (equalHL.eqh && direction === 'SHORT') { shortScore++; shortR.push('EQH Above 💧'); }

    // Premium / Discount Zone
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

    // Fibonacci Confluence
    if (fibConf.hasConfluence) {
        if (direction === 'LONG') { longScore  += 2; longR.push(`Fib Confluence ${fibConf.count}× 🔢`); }
        else                      { shortScore += 2; shortR.push(`Fib Confluence ${fibConf.count}× 🔢`); }
    }

    // Daily Pivot
    if (pivotSignal.isBull) { longScore++;  longR.push(`Pivot ${pivotSignal.nearLevel?.name || ''} Support 📌`); }
    if (pivotSignal.isBear) { shortScore++; shortR.push(`Pivot ${pivotSignal.nearLevel?.name || ''} Resist 📌`); }

    // Ichimoku
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

    // CVD
    if      (cvd.bullDiv)           { longScore  += 2; longR.push('CVD Bull Div 📊🚀'); }
    else if (cvd.trend === 'BULL')  { longScore++;     longR.push('CVD Rising 📊🟢'); }
    if      (cvd.bearDiv)           { shortScore += 2; shortR.push('CVD Bear Div 📊⚠️'); }
    else if (cvd.trend === 'BEAR')  { shortScore++;    shortR.push('CVD Falling 📊🔴'); }

    // Heikin Ashi
    if (heikinAshi.isStrong && heikinAshi.isBull) { longScore++;  longR.push(`HA ${heikinAshi.consecutive}× Bull 🕯️`); }
    if (heikinAshi.isStrong && heikinAshi.isBear) { shortScore++; shortR.push(`HA ${heikinAshi.consecutive}× Bear 🕯️`); }

    // Williams %R
    if (williamsR.isBull) { longScore++;  longR.push(`W%R ${williamsR.value} 🟢`); }
    if (williamsR.isBear) { shortScore++; shortR.push(`W%R ${williamsR.value} 🔴`); }

    // ════════════════════════════════════════════
    // v6 BIG-PROFIT SCORING FACTORS
    // ════════════════════════════════════════════

    // BB Squeeze Explosion — highest energy release signal
    if (bbSqueeze.exploding) {
        if (bbSqueeze.explosionDir === 'BULL') { longScore  += 3; longR.push('BB Explosion 💥🟢'); }
        else                                   { shortScore += 3; shortR.push('BB Explosion 💥🔴'); }
    } else if (bbSqueeze.isSqueezing && bbSqueeze.squeezeDuration >= 3) {
        longScore += 1; shortScore += 1;  // +1 to both: breakout imminent, direction unknown
        longR.push('BB Squeeze ⚡'); shortR.push('BB Squeeze ⚡');
    }

    // Volatility Expansion — ADX surge = trend just started
    if (volExpansion.justStarted) {
        // "Just started" = earliest entry into a new trend = max reward
        if (direction === 'LONG') { longScore  += 3; longR.push('Trend Start! ADX⚡'); }
        else                      { shortScore += 3; shortR.push('Trend Start! ADX⚡'); }
    } else if (volExpansion.expanding) {
        if (direction === 'LONG') { longScore  += 1; longR.push('Volatility Expanding 📈'); }
        else                      { shortScore += 1; shortR.push('Volatility Expanding 📉'); }
    }

    // Market Maker Trap — high probability reversal
    if (mmTrap.bearTrap && direction === 'LONG')  { longScore  += 3; longR.push('Bear Trap! LONG 🪤'); }
    if (mmTrap.bullTrap && direction === 'SHORT') { shortScore += 3; shortR.push('Bull Trap! SHORT 🪤'); }

    // 3-Timeframe Alignment
    if (tf3Align.aligned) {
        if (tf3Align.allBull) { longScore  += 2; longR.push('3TF Aligned 🟢🟢🟢'); }
        if (tf3Align.allBear) { shortScore += 2; shortR.push('3TF Aligned 🔴🔴🔴'); }
    }

    // HTF Daily Trend Gate — trading with daily trend = much higher win rate
    if (dailyAligned) {
        if (direction === 'LONG') { longScore  += 2; longR.push('Daily Trend ✅'); }
        else                      { shortScore += 2; shortR.push('Daily Trend ✅'); }
    } else if (dailyTrend !== 'Unknown ⚪') {
        // Against daily trend = significant penalty
        if (direction === 'LONG')  longScore  = Math.max(0, longScore  - 2);
        if (direction === 'SHORT') shortScore = Math.max(0, shortScore - 2);
    }

    // CME Gap as TP magnet (bonus score for gap alignment)
    if (cmeGap.hasGap && !cmeGap.filled) {
        const gapDir = cmeGap.gapAbove ? 'LONG' : 'SHORT'; // gap above = price likely goes up
        if (gapDir === direction) {
            if (direction === 'LONG') { longScore  += 1; longR.push('CME Gap Target 🎯'); }
            else                      { shortScore += 1; shortR.push('CME Gap Target 🎯'); }
        }
    }

    // Weekly target within reach (+1 if TP2 or beyond could hit weekly level)
    if (weeklyTgts && weeklyTgts.nearTarget) {
        const tpDist  = Math.abs(tp2 - currentPrice) / currentPrice;
        const wkDist  = Math.abs(weeklyTgts.nearTarget - currentPrice) / currentPrice;
        if (wkDist <= tpDist * 1.5) { // weekly target within 1.5× of TP2 distance
            if (direction === 'LONG') { longScore++;  longR.push('Weekly Level TP 🗓️'); }
            else                      { shortScore++; shortR.push('Weekly Level TP 🗓️'); }
        }
    }

    // ════════════════════════════════════════════
    // ⚡ 5m SNIPER LAYER — SCORING BONUSES
    // These factors are in addition to the 14 base factors above.
    // They reward high-confluence setups where the 5m microstructure
    // aligns with the primary timeframe bias — the sniper entry signal.
    // ════════════════════════════════════════════

    // 5m ChoCH (Change of Character) — strongest sniper trigger
    // A ChoCH on 5m means institutional participants have flipped structure
    // on the lowest granularity, confirming the higher-TF move is starting NOW.
    if (choch5m.includes('Bullish')) {
        longScore  += 2;
        longR.push('5m ChoCH 🔄🟢⚡');
    }
    if (choch5m.includes('Bearish')) {
        shortScore += 2;
        shortR.push('5m ChoCH 🔄🔴⚡');
    }

    // 5m Liquidity Sweep — institutional stop-hunt confirmation on 5m
    // Price swept below (LONG) or above (SHORT) recent 5m liquidity before reversing
    if (sweep5m.includes('Bullish')) {
        longScore  += 2;
        longR.push('5m Liq Sweep 🟢⚡');
    }
    if (sweep5m.includes('Bearish')) {
        shortScore += 2;
        shortR.push('5m Liq Sweep 🔴⚡');
    }

    // 5m Order Block alignment — microstructure OB in trade direction
    if (ob5m.bullish && direction === 'LONG') {
        longScore++;
        longR.push('5m OB 🟢');
    }
    if (ob5m.bearish && direction === 'SHORT') {
        shortScore++;
        shortR.push('5m OB 🔴');
    }

    // 5m trend EMA alignment (price above/below 5m EMA21 confirms momentum)
    if (trend5m.includes('Bullish') && direction === 'LONG') {
        longScore  += 0.5;
        longR.push('5m EMA Trend 🟢');
    }
    if (trend5m.includes('Bearish') && direction === 'SHORT') {
        shortScore += 0.5;
        shortR.push('5m EMA Trend 🔴');
    }

    // Sniper category bonus: reward SWING and SCALP classifications
    // with a score bump because they require the highest confluence.
    if (tradeCategory.label.includes('SWING')) {
        if (direction === 'LONG') { longScore++;  longR.push('4H OB Sniper 📅'); }
        else                      { shortScore++; shortR.push('4H OB Sniper 📅'); }
    }
    if (tradeCategory.label.includes('SCALP')) {
        if (direction === 'LONG') { longScore++;  longR.push('15m OB Scalp ⚡'); }
        else                      { shortScore++; shortR.push('15m OB Scalp ⚡'); }
    }

    const finalScore   = direction === 'LONG' ? Math.floor(longScore) : Math.floor(shortScore);
    const finalReasons = (direction === 'LONG' ? longR : shortR).join(', ') || 'None';

    // ── 8. Return Master Object ──────────────────────────────────
    // All original fields preserved. New 5m sniper fields appended.
    return {
        // ── Core price & trend ──
        priceStr, currentPrice, currentCandles,
        direction, mainTrend, trend1H, trend4H, marketState, isTrueChoppy,

        // ── Primary-TF indicators ──
        adxData, rsi, vwap, macd, harmonicPattern, ictSilverBullet,
        marketSMC, mtf5m,

        // ── Entry zone & order management ──
        bestEntry, confirmation, orderSuggestion,
        entryPrice: entryPrice.toFixed(4),
        sl:      parseFloat(sl).toFixed(4),
        slLabel: slLabel || 'ATR',
        tp1: parseFloat(tp1).toFixed(4), tp1Label: smartTPData.tp1Label,
        tp2: parseFloat(tp2).toFixed(4), tp2Label: smartTPData.tp2Label,
        tp3: parseFloat(tp3).toFixed(4), tp3Label: smartTPData.tp3Label,

        // ── v4 precision data ──
        stochRSI, bbands, mtfOB, mtfOBsExtra,
        liquiditySweep, choch, entryValidation,

        // ── Scoring ──
        score: finalScore, maxScore: 70, reasons: finalReasons,   // maxScore 55→70 for v6 bonus factors

        // ── v4 confirmation ──
        mtfRSI, volNodes, session, candleConf,
        keyLevels, emaRibbon, fvgData,
        supertrend, rvol, mtfMACD,

        // ── v5 world-class ──
        wyckoff, breakers, equalHL, pdZone,
        williamsR, ichimoku, heikinAshi, cvd,
        pivots, pivotSignal, fibConf,

        // ── ⚡ 5m Sniper Layer (NEW) ──────────────────────────────
        // MTF Trade Classification
        tradeCategory,          // { label, htfZone, confirmTF, holdTime, riskNote, emoji }

        // 5m raw SMC data
        ob5m,                   // { bullish: {bottom, top} | null, bearish: ... }
        choch5m,                // string — e.g. "Bullish ChoCH 🟢 (Structure Reversal Up)"
        sweep5m,                // string — e.g. "Bullish Sweep 🟢 (Sell-side Liquidity Taken)"
        fvg5m,                  // { bullFVGs: [], bearFVGs: [], nearest: null }
        smc5m,                  // full SMC object on 5m
        trend5m,                // "Bullish 🟢" or "Bearish 🔴"
        ema21_5m,               // numeric

        // HTF OB detection results used for classification
        ob4H,                   // detectMTFOBs result for 4H candles
        ob1H,                   // detectMTFOBs result for 1H candles
        ob15m,                  // detectMTFOBs result for 15m candles
        choch15m,               // 15m ChoCH string
        sweep15m,               // 15m Sweep string

        // ⚡ v6 BIG-PROFIT fields ─────────────────────────────────
        bbSqueeze,              // BB squeeze/explosion state
        volExpansion,           // ADX surge = trend just started
        mmTrap,                 // Market Maker Trap detector
        weeklyTgts,             // Weekly/monthly TP targets
        cmeGap,                 // CME gap fill target
        tf3Align,               // 3-TF alignment status
        dailyTrend,             // Daily EMA50 trend direction
        dailyAligned,           // true = trade WITH daily trend
    };
}

module.exports = { run14FactorAnalysis };
