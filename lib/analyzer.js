const binance = require('./binance');
const indicators = require('./indicators');
const smc = require('./smartmoney');
// ✅ v4 precision tools
const { calculateStochRSI, calculateBollingerBands, detectMTFOrderBlocks, detectMTFOBs, validateEntryPoint, calculateSmartTPs, calculateSmartSL, checkMTFRSIConfluence, detectVolumeNodes, getSessionQuality, checkCandleCloseConfirmation, getKeyLevels, getEMARibbon, scanFairValueGaps, calculateSupertrend, calculateRVOL, checkMTFMACD } = require('./indicators');
// 🆕 v5 new world-class indicators
const { detectWyckoffPhase, detectBreakerBlocks, detectEqualHighsLows, checkPremiumDiscount, calculateWilliamsR, calculateIchimoku, getHeikinAshiTrend, approximateCVD, calculatePivotPoints, getPivotSignal, checkFibConfluence } = require('./indicators');

/**
 * 14-Factor Ultimate Market Analyzer Engine
 * (Shareable module for Future, Spot, and Scanner)
 */
async function run14FactorAnalysis(coin, timeframe = '15m') {
    // 1. Data Fetching
    const currentCandles = await binance.getKlineData(coin, timeframe, 500);
    const candles5m      = await binance.getKlineData(coin, '5m', 50);   
    const candles1H      = await binance.getKlineData(coin, '1h', 60);
    const candles4H      = await binance.getKlineData(coin, '4h', 60);
    // 🆕 v5: Daily candles for Pivot Points
    const candlesDaily   = await binance.getKlineData(coin, '1d', 10).catch(() => null);
    
    const currentPrice   = parseFloat(currentCandles[currentCandles.length - 1][4]);
    const priceStr       = currentPrice.toFixed(4);

    // 2. Core Indicators
    const ema200 = parseFloat(indicators.calculateEMA(currentCandles, 200));
    const ema50  = parseFloat(indicators.calculateEMA(currentCandles.slice(-100), 50)); 
    const ema1H  = parseFloat(indicators.calculateEMA(candles1H, 50));
    const ema4H  = parseFloat(indicators.calculateEMA(candles4H, 50));
    
    const trend1H = parseFloat(candles1H[candles1H.length-1][4]) > ema1H ? "Bullish 🟢" : "Bearish 🔴";
    const trend4H = parseFloat(candles4H[candles4H.length-1][4]) > ema4H ? "Bullish 🟢" : "Bearish 🔴";
    const mainTrend = currentPrice > ema200 ? "Bullish 🟢" : "Bearish 🔴";
    const direction = mainTrend.includes("Bullish") ? "LONG" : "SHORT";

    // 3. Market State & Choppy Detection
    const adxData = indicators.calculateADX(currentCandles.slice(-50));
    const isHTFAligned = (trend1H.includes("Bullish") && trend4H.includes("Bullish")) || 
                         (trend1H.includes("Bearish") && trend4H.includes("Bearish"));
                         
    let marketState = "TRENDING 🚀";
    let isTrueChoppy = false;

    if (!adxData.isStrong) { 
        if (isHTFAligned) marketState = `CONSOLIDATION ⏳ (${trend4H.includes("Bullish") ? 'Bull Flag' : 'Bear Flag'})`;
        else { marketState = `TRUE CHOPPY ⚖️ (Grid Mode Active)`; isTrueChoppy = true; }
    }

    // 4. Advanced Metrics & SMC
    const rsi = indicators.calculateRSI(currentCandles.slice(-50), 14);
    const atr = indicators.calculateATR(currentCandles.slice(-50));
    const atrVal = parseFloat(atr);
    const macd = indicators.calculateMACD(currentCandles.slice(-50));
    const vwap = indicators.calculateVWAP(currentCandles);
    const poc = indicators.calculatePOC(currentCandles.slice(-50));
    const pattern = indicators.checkCandlePattern(currentCandles.slice(-10));
    const volBreak = indicators.checkVolumeBreakout(currentCandles.slice(-50));
    const divergence = indicators.checkDivergence(currentCandles.slice(-50));
    const harmonicPattern = indicators.checkHarmonicPattern(currentCandles.slice(-100));
    const ictSilverBullet = indicators.checkICTSilverBullet(currentCandles.slice(-10));
    const marketSMC = smc.analyzeSMC(currentCandles.slice(-50));
    const mtf5m = indicators.confirmEntry5m(candles5m, direction);

    // ✅ NEW v4: Liquidity Sweep + ChoCH (unused until now)
    const liquiditySweep = smc.checkLiquiditySweep(currentCandles.slice(-15));
    const choch          = smc.checkChoCH(currentCandles.slice(-20));
    const mtfOBsExtra    = detectMTFOBs(currentCandles.slice(-15));

    // ✅ Precision indicators
    const stochRSI   = calculateStochRSI(currentCandles.slice(-60));
    const bbands     = calculateBollingerBands(currentCandles.slice(-30));
    const mtfOB      = detectMTFOrderBlocks(currentCandles.slice(-30), candles1H.slice(-20));
    
    // ✅ NEW: Advanced entry confirmation
    const mtfRSI     = checkMTFRSIConfluence(currentCandles.slice(-50), candles1H.slice(-50));
    const volNodes   = detectVolumeNodes(currentCandles.slice(-100));
    const session    = getSessionQuality();
    const candleConf = checkCandleCloseConfirmation(currentCandles.slice(-5), direction, null);
    
    // ✅ NEW: Key S/R levels, EMA Ribbon, FVG targets
    const keyLevels  = getKeyLevels(currentCandles.slice(-100));
    const emaRibbon  = getEMARibbon(currentCandles);
    const fvgData      = scanFairValueGaps(currentCandles.slice(-50));
    
    // ✅ NEW v4 indicators
    const supertrend   = calculateSupertrend(currentCandles.slice(-60));
    const rvol         = calculateRVOL(currentCandles.slice(-30));
    const mtfMACD      = checkMTFMACD(currentCandles.slice(-60), candles1H.slice(-60));

    // 🆕 v5 WORLD-CLASS INDICATORS
    const wyckoff      = detectWyckoffPhase(currentCandles.slice(-55));
    const breakers     = detectBreakerBlocks(currentCandles.slice(-40));
    const equalHL      = detectEqualHighsLows(currentCandles.slice(-60));
    const pdZone       = checkPremiumDiscount(currentCandles.slice(-60), direction);
    const williamsR    = calculateWilliamsR(currentCandles.slice(-20));
    const ichimoku     = calculateIchimoku(currentCandles.slice(-60));
    const heikinAshi   = getHeikinAshiTrend(currentCandles.slice(-15));
    const cvd          = approximateCVD(currentCandles.slice(-30));
    const pivots       = calculatePivotPoints(candlesDaily);
    const pivotSignal  = getPivotSignal(currentPrice, pivots, direction);
    const fibConf      = checkFibConfluence(currentCandles.slice(-60), direction);

    // 5. Entry & Order Types
    const vwapMatch = vwap.match(/\$([0-9.]+)/);
    const vwapPrice = vwapMatch ? parseFloat(vwapMatch[1]) : 0;
    const obForDir  = direction === 'LONG' ? marketSMC.bullishOB : marketSMC.bearishOB;

    const bestEntry     = smc.selectBestEntry(priceStr, obForDir, marketSMC.fib618, poc, vwapPrice, direction, atrVal, harmonicPattern);
    const entryValidation = validateEntryPoint(bestEntry.price, currentPrice, direction);
    const confirmation = smc.checkOBConfirmation(currentCandles.slice(-5), obForDir, direction);
    const orderSuggestion = smc.getOrderTypeSuggestion(bestEntry.price, currentPrice, direction);

    // 6. ✅ UPGRADED: Smart SL/TP Calculation
    const entryPrice = parseFloat(bestEntry.price);
    
    // Smart SL: Swing Low/High + OB + ATR (tightest valid level)
    const smartSLData = calculateSmartSL(
        entryPrice, direction, currentCandles.slice(-30), obForDir, atrVal
    );
    const sl = parseFloat(smartSLData.sl);
    const slLabel = smartSLData.slLabel;
    
    // Smart TPs: Fib Extensions (1.618, 2.618) + RRR + Whale walls
    const smartTPData = calculateSmartTPs(entryPrice, sl, direction, currentCandles.slice(-50));
    const tp1 = parseFloat(smartTPData.tp1);
    const tp2 = parseFloat(smartTPData.tp2);
    const tp3 = parseFloat(smartTPData.tp3);

    // 7. 14-Factor Scoring System
    let longScore = 0, shortScore = 0, longR = [], shortR = [];

    if (trend4H.includes("Bullish") && trend1H.includes("Bullish")) { longScore++; longR.push("MTF Bull"); }
    if (trend4H.includes("Bearish") && trend1H.includes("Bearish")) { shortScore++; shortR.push("MTF Bear"); }
    if (currentPrice > ema200 && Math.abs(currentPrice-ema50)/ema50 < 0.003) { longScore++; longR.push("EMA Pullback"); }
    if (currentPrice < ema200 && Math.abs(currentPrice-ema50)/ema50 < 0.003) { shortScore++; shortR.push("EMA Pullback"); }
    if (marketSMC.bullishOB) { longScore++; longR.push("Bull OB"); }
    if (marketSMC.bearishOB) { shortScore++; shortR.push("Bear OB"); }
    if (rsi < 45) { longScore++; longR.push("RSI Oversold"); }
    if (rsi > 55) { shortScore++; shortR.push("RSI Overbought"); }
    if (vwap.includes('🟢')) { longScore++; longR.push("Above VWAP"); }
    if (vwap.includes('🔴')) { shortScore++; shortR.push("Below VWAP"); }
    if (pattern.includes('🟢')) { longScore++; longR.push(pattern.split(' ')[0]); }
    if (pattern.includes('🔴')) { shortScore++; shortR.push(pattern.split(' ')[0]); }
    if (volBreak.includes("Bullish Breakout")) { longScore++; longR.push("Vol Spike"); }
    if (volBreak.includes("Bearish Breakout")) { shortScore++; shortR.push("Vol Spike"); }
    if (divergence.includes("Bullish")) { longScore++; longR.push("Divergence"); }
    if (divergence.includes("Bearish")) { shortScore++; shortR.push("Divergence"); }
    if (macd.includes("Bullish")) { longScore++; longR.push("MACD Bull"); }
    if (macd.includes("Bearish")) { shortScore++; shortR.push("MACD Bear"); }
    if (marketSMC.sweep.includes("Bullish") || marketSMC.choch.includes("Bullish")) { longScore++; longR.push("Sweep/ChoCH"); }
    if (marketSMC.sweep.includes("Bearish") || marketSMC.choch.includes("Bearish")) { shortScore++; shortR.push("Sweep/ChoCH"); }
    if (confirmation.confirmed) {
        if (direction === 'LONG') { longScore++; longR.push("OB Touch ✅"); } else { shortScore++; shortR.push("OB Touch ✅"); }
    }
    if (mtf5m.confirmed) {
        if (direction === 'LONG') { longScore++; longR.push("5m Aligned ✅"); } else { shortScore++; shortR.push("5m Aligned ✅"); }
    }
    if (harmonicPattern.includes("Bullish")) { longScore++; longR.push(harmonicPattern.split(' ')[1]); }
    if (harmonicPattern.includes("Bearish")) { shortScore++; shortR.push(harmonicPattern.split(' ')[1]); }
    if (ictSilverBullet.includes("Bullish")) { longScore++; longR.push("ICT Time 🎯"); }
    if (ictSilverBullet.includes("Bearish")) { shortScore++; shortR.push("ICT Time 🎯"); }

    // ✅ NEW: StochRSI score factor
    if (stochRSI.isBull) { longScore++; longR.push(`StochRSI ${stochRSI.signal}`); }
    if (stochRSI.isBear) { shortScore++; shortR.push(`StochRSI ${stochRSI.signal}`); }
    
    // ✅ NEW: Bollinger Band score factor
    if (bbands.isBull) { longScore++; longR.push("BB Lower Zone"); }
    if (bbands.isBear) { shortScore++; shortR.push("BB Upper Zone"); }
    if (bbands.squeeze) { longScore += 0.5; shortScore += 0.5; } // both benefit from pending breakout
    
    // ✅ MTF OB Confluence
    if (mtfOB.confluenceZone) {
        if (mtfOB.confluenceZone.type === 'BULLISH') { longScore += 2; longR.push("MTF OB Confluence 🔥"); }
        if (mtfOB.confluenceZone.type === 'BEARISH') { shortScore += 2; shortR.push("MTF OB Confluence 🔥"); }
    }
    
    // ✅ NEW: EMA Ribbon scoring
    if (emaRibbon) {
        if (emaRibbon.signal === 'STRONG_BULL')   { longScore  += 2; longR.push("EMA Ribbon Bull 🟢🟢"); }
        if (emaRibbon.signal === 'STRONG_BEAR')   { shortScore += 2; shortR.push("EMA Ribbon Bear 🔴🔴"); }
        if (emaRibbon.signal === 'BULL_PULLBACK') { longScore++;  longR.push("EMA21 Pullback 🟡"); }
        if (emaRibbon.signal === 'BEAR_PULLBACK') { shortScore++; shortR.push("EMA21 Pullback 🟡"); }
    }
    
    // ✅ NEW: MTF RSI Confluence
    if (mtfRSI.isBull) { longScore  += mtfRSI.signal === 'STRONG_BULL' ? 2 : 1; longR.push("MTF RSI Bull"); }
    if (mtfRSI.isBear) { shortScore += mtfRSI.signal === 'STRONG_BEAR' ? 2 : 1; shortR.push("MTF RSI Bear"); }
    
    // ✅ NEW: High Volume Node entry (+1 if price at HVN)
    if (volNodes.nearHVN) {
        if (direction === 'LONG') { longScore++; longR.push("HVN Zone 🔥"); }
        else { shortScore++; shortR.push("HVN Zone 🔥"); }
    }
    
    // ✅ NEW: Session Quality (best session = entry bonus)
    if (session.isBestSession) {
        if (direction === 'LONG') { longScore += 0.5; longR.push(`${session.emoji} ${session.session}`); }
        else { shortScore += 0.5; shortR.push(`${session.emoji} ${session.session}`); }
    }
    
    // ✅ NEW: Candle Close Confirmation
    if (candleConf.confirmed) {
        if (direction === 'LONG') { longScore++; longR.push("Candle Close ✅"); }
        else { shortScore++; shortR.push("Candle Close ✅"); }
    }

    // ✅ NEW: Liquidity Sweep scoring
    if (liquiditySweep.includes("Bullish")) { longScore  += 2; longR.push("Liq Sweep 🟢"); }
    if (liquiditySweep.includes("Bearish")) { shortScore += 2; shortR.push("Liq Sweep 🔴"); }

    // ✅ NEW: ChoCH (Change of Character) scoring
    if (choch.includes("Bullish")) { longScore  += 2; longR.push("ChoCH 🔄🟢"); }
    if (choch.includes("Bearish")) { shortScore += 2; shortR.push("ChoCH 🔄🔴"); }

    // ✅ NEW v4: Supertrend scoring
    if (supertrend.justFlipUp)    { longScore  += 2; longR.push("Supertrend Flip 🟢🟢"); }
    else if (supertrend.isBull)   { longScore++;  longR.push("Supertrend Bull 🟢"); }
    if (supertrend.justFlipDown)  { shortScore += 2; shortR.push("Supertrend Flip 🔴🔴"); }
    else if (supertrend.isBear)   { shortScore++;  shortR.push("Supertrend Bear 🔴"); }

    // ✅ NEW v4: RVOL - strong volume confirms the move
    if (rvol.signal === 'EXTREME' || rvol.signal === 'HIGH') {
        longScore += 0.5; shortScore += 0.5;
        longR.push("RVOL High 🔥"); shortR.push("RVOL High 🔥");
    }

    // ✅ NEW v4: MTF MACD Confluence
    if (mtfMACD.signal === 'STRONG_BULL') { longScore  += 2; longR.push("MTF MACD Bull 🟢🟢"); }
    if (mtfMACD.signal === 'STRONG_BEAR') { shortScore += 2; shortR.push("MTF MACD Bear 🔴🔴"); }

    // ✅ NEW: Extra MTF OBs (short-term OBs)
    if (mtfOBsExtra.bullish && direction === 'LONG')  { longScore++;  longR.push("Short OB 🟢"); }
    if (mtfOBsExtra.bearish && direction === 'SHORT') { shortScore++; shortR.push("Short OB 🔴"); }

    // ══════════════════════════════════════════
    // 🆕 v5 WORLD-CLASS SCORING FACTORS
    // ══════════════════════════════════════════

    // Wyckoff Phase (highest probability setups in existence)
    if (wyckoff.phase === 'SPRING')         { longScore  += 3; longR.push("Wyckoff Spring 🌱🌱🌱"); }
    else if (wyckoff.phase === 'MARKUP')    { longScore++;     longR.push("Wyckoff Markup 📈"); }
    else if (wyckoff.phase === 'ACCUMULATION') { longScore += 0.5; longR.push("Wyckoff Accum 🔄"); }
    if (wyckoff.phase === 'UTAD')           { shortScore += 3; shortR.push("Wyckoff UTAD ⚡⚡⚡"); }
    else if (wyckoff.phase === 'MARKDOWN')  { shortScore++;    shortR.push("Wyckoff Markdown 📉"); }
    else if (wyckoff.phase === 'DISTRIBUTION') { shortScore += 0.5; shortR.push("Wyckoff Dist 🔄"); }

    // Breaker Blocks (failed OB = institutional reentry)
    if (breakers.bullishBreaker && direction === 'LONG')  { longScore  += 2; longR.push("Bull Breaker 🔲"); }
    if (breakers.bearishBreaker && direction === 'SHORT') { shortScore += 2; shortR.push("Bear Breaker 🔲"); }

    // EQH/EQL — liquidity pools as targets (aligned with direction)
    if (equalHL.eql && direction === 'LONG')  { longScore++;  longR.push("EQL Below 💧"); }   // EQL below = LONG SL protection / target
    if (equalHL.eqh && direction === 'SHORT') { shortScore++; shortR.push("EQH Above 💧"); }   // EQH above = SHORT target

    // Premium/Discount Zone alignment
    if (pdZone.zone === 'OTE')     { longScore += 2; shortScore += 2; longR.push("OTE Zone 🎯"); shortR.push("OTE Zone 🎯"); }
    else if (pdZone.tradeMatch)    { if (direction==='LONG') { longScore++;  longR.push("Discount Zone 🟢"); } else { shortScore++; shortR.push("Premium Zone 🔴"); } }
    // Penalty: trading against zone (LONG in premium or SHORT in discount)
    else if (!pdZone.tradeMatch && pdZone.zone !== 'EQUILIBRIUM' && pdZone.zone !== 'UNKNOWN') {
        if (direction==='LONG')  longScore  = Math.max(0, longScore  - 1);
        if (direction==='SHORT') shortScore = Math.max(0, shortScore - 1);
    }

    // Fibonacci Confluence Zone
    if (fibConf.hasConfluence) {
        if (direction==='LONG')  { longScore  += 2; longR.push(`Fib Confluence ${fibConf.count}× 🔢`); }
        else                     { shortScore += 2; shortR.push(`Fib Confluence ${fibConf.count}× 🔢`); }
    }

    // Daily Pivot Signal
    if (pivotSignal.isBull) { longScore++;  longR.push(`Pivot ${pivotSignal.nearLevel?.name||''} Support 📌`); }
    if (pivotSignal.isBear) { shortScore++; shortR.push(`Pivot ${pivotSignal.nearLevel?.name||''} Resist 📌`); }

    // Ichimoku Cloud
    if (ichimoku.signal === 'STRONG_BULL') { longScore  += 2; longR.push("Ichimoku Bull Cross ☁️🚀"); }
    else if (ichimoku.signal === 'BULL')   { longScore++;     longR.push("Ichimoku Bull ☁️🟢"); }
    else if (ichimoku.signal === 'MILD_BULL') { longScore += 0.5; }
    if (ichimoku.signal === 'STRONG_BEAR') { shortScore += 2; shortR.push("Ichimoku Bear Cross ☁️📉"); }
    else if (ichimoku.signal === 'BEAR')   { shortScore++;    shortR.push("Ichimoku Bear ☁️🔴"); }
    else if (ichimoku.signal === 'MILD_BEAR') { shortScore += 0.5; }
    // Penalty: trading into cloud
    if (ichimoku.inCloud) { longScore = Math.max(0, longScore-1); shortScore = Math.max(0, shortScore-1); }

    // CVD (buying/selling pressure confirmation + divergence)
    if (cvd.bullDiv)              { longScore  += 2; longR.push("CVD Bull Div 📊🚀"); }
    else if (cvd.trend === 'BULL') { longScore++;    longR.push("CVD Rising 📊🟢"); }
    if (cvd.bearDiv)              { shortScore += 2; shortR.push("CVD Bear Div 📊⚠️"); }
    else if (cvd.trend === 'BEAR') { shortScore++;   shortR.push("CVD Falling 📊🔴"); }

    // Heikin Ashi Trend (strong streak = momentum)
    if (heikinAshi.isStrong && heikinAshi.isBull) { longScore++;  longR.push(`HA ${heikinAshi.consecutive}× Bull 🕯️`); }
    if (heikinAshi.isStrong && heikinAshi.isBear) { shortScore++; shortR.push(`HA ${heikinAshi.consecutive}× Bear 🕯️`); }

    // Williams %R
    if (williamsR.isBull) { longScore++;  longR.push(`W%R ${williamsR.value} 🟢`); }
    if (williamsR.isBear) { shortScore++; shortR.push(`W%R ${williamsR.value} 🔴`); }

    const finalScore  = direction === 'LONG' ? Math.floor(longScore) : Math.floor(shortScore);
    const finalReasons = (direction === 'LONG' ? longR : shortR).join(', ') || "None";

    // 8. Return Everything as a Master Object
    return {
        priceStr, currentPrice, currentCandles,
        direction, mainTrend, trend1H, trend4H, marketState, isTrueChoppy,
        adxData, rsi, vwap, macd, harmonicPattern, ictSilverBullet,
        marketSMC, mtf5m,
        bestEntry, confirmation, orderSuggestion,
        entryPrice: entryPrice.toFixed(4),
        sl: parseFloat(sl).toFixed(4),
        slLabel: slLabel || "ATR",
        tp1: parseFloat(tp1).toFixed(4), tp1Label: smartTPData.tp1Label,
        tp2: parseFloat(tp2).toFixed(4), tp2Label: smartTPData.tp2Label,
        tp3: parseFloat(tp3).toFixed(4), tp3Label: smartTPData.tp3Label,
        stochRSI, bbands, mtfOB, mtfOBsExtra,
        liquiditySweep, choch, entryValidation,
        score: finalScore, maxScore: 50, reasons: finalReasons,
        // v4 confirmation data
        mtfRSI, volNodes, session, candleConf,
        keyLevels, emaRibbon, fvgData,
        supertrend, rvol, mtfMACD,
        // 🆕 v5 world-class indicators
        wyckoff, breakers, equalHL, pdZone,
        williamsR, ichimoku, heikinAshi, cvd,
        pivots, pivotSignal, fibConf
    };
}

module.exports = {
    run14FactorAnalysis
};
