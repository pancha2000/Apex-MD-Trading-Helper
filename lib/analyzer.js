const binance = require('./binance');
const indicators = require('./indicators');
const smc = require('./smartmoney');

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

    // 5. Entry & Order Types
    const vwapMatch = vwap.match(/\$([0-9.]+)/);
    const vwapPrice = vwapMatch ? parseFloat(vwapMatch[1]) : 0;
    const obForDir  = direction === 'LONG' ? marketSMC.bullishOB : marketSMC.bearishOB;

    const bestEntry = smc.selectBestEntry(priceStr, obForDir, marketSMC.fib618, poc, vwapPrice, direction, atrVal, harmonicPattern);
    const confirmation = smc.checkOBConfirmation(currentCandles.slice(-5), obForDir, direction);
    const orderSuggestion = smc.getOrderTypeSuggestion(bestEntry.price, currentPrice, direction);

    // 6. TPs and SL Calculation
    const entryPrice = parseFloat(bestEntry.price);
    let sl, tp1, tp2;

    if (direction === 'LONG') {
        const zoneSL = parseFloat(bestEntry.sl);
        const atrSL  = entryPrice - atrVal * 1.5;
        sl = (entryPrice - zoneSL) < atrVal * 3 ? zoneSL : atrSL;
        tp1 = (entryPrice + atrVal * 2.5);   
        tp2 = (entryPrice + atrVal * 4.0);   
    } else {
        const zoneSL = parseFloat(bestEntry.sl);
        const atrSL  = entryPrice + atrVal * 1.5;
        sl = (zoneSL - entryPrice) < atrVal * 3 ? zoneSL : atrSL;
        tp1 = (entryPrice - atrVal * 2.5);
        tp2 = (entryPrice - atrVal * 4.0);
    }

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

    const finalScore  = direction === 'LONG' ? longScore : shortScore;
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
        tp1: parseFloat(tp1).toFixed(4),
        tp2: parseFloat(tp2).toFixed(4),
        score: finalScore, maxScore: 14, reasons: finalReasons
    };
}

module.exports = {
    run14FactorAnalysis
};
