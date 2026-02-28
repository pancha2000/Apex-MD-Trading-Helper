const binance = require('./binance');
const indicators = require('./indicators');
const smc = require('./smartmoney');
// ✅ NEW precision tools
const { calculateStochRSI, calculateBollingerBands, detectMTFOrderBlocks, detectMTFOBs, validateEntryPoint, calculateSmartTPs, calculateSmartSL, checkMTFRSIConfluence, detectVolumeNodes, getSessionQuality, checkCandleCloseConfirmation, getKeyLevels, getEMARibbon, scanFairValueGaps } = require('./indicators');

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

    // ✅ NEW: Liquidity Sweep + ChoCH (unused until now)
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
    const fvgData    = scanFairValueGaps(currentCandles.slice(-50));

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

    // ✅ NEW: Extra MTF OBs (short-term OBs)
    if (mtfOBsExtra.bullish && direction === 'LONG')  { longScore++;  longR.push("Short OB 🟢"); }
    if (mtfOBsExtra.bearish && direction === 'SHORT') { shortScore++; shortR.push("Short OB 🔴"); }

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
        score: finalScore, maxScore: 27,  // EMA ribbon adds up to +2 reasons: finalReasons,
        // New confirmation data for display
        mtfRSI, volNodes, session, candleConf,
        keyLevels, emaRibbon, fvgData
    };
}

module.exports = {
    run14FactorAnalysis
};
