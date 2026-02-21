function calculateRSI(candles, period = 14) {
    let gains = 0, losses = 0;
    for (let i = candles.length - period - 1; i < candles.length - 1; i++) {
        let change = parseFloat(candles[i + 1][4]) - parseFloat(candles[i][4]);
        if (change > 0) gains += change; else losses -= change;
    }
    let rs = (gains / period) / (losses / period || 1);
    return (100 - (100 / (1 + rs))).toFixed(2);
}

function calculateEMA(candles, period = 50) {
    if (candles.length < period) return null;
    const k = 2 / (period + 1);
    let ema = parseFloat(candles[0][4]);
    for (let i = 1; i < candles.length; i++) ema = (parseFloat(candles[i][4]) * k) + (ema * (1 - k));
    return ema.toFixed(2);
}

function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    let trs = [];
    for (let i = 1; i < candles.length; i++) {
        let high = parseFloat(candles[i][2]), low = parseFloat(candles[i][3]), prevClose = parseFloat(candles[i - 1][4]);
        trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    let atrSum = 0;
    for (let i = trs.length - period; i < trs.length; i++) atrSum += trs[i];
    return (atrSum / period).toFixed(4);
}

function checkDivergence(candles) {
    if (candles.length < 35) return "None";
    let currentPrice = parseFloat(candles[candles.length - 1][4]);
    let pastPrice = parseFloat(candles[candles.length - 15][4]);
    let currentRSI = parseFloat(calculateRSI(candles.slice(-20)));
    let pastRSI = parseFloat(calculateRSI(candles.slice(-35, -15)));

    if (currentPrice < pastPrice && currentRSI > pastRSI && currentRSI < 50) return "Bullish Divergence 🚀";
    if (currentPrice > pastPrice && currentRSI < pastRSI && currentRSI > 50) return "Bearish Divergence ⚠️";
    return "None";
}

// 🕯️ අලුතින් එකතු කළ Candlestick Pattern Recognition
function checkCandlePattern(candles) {
    if (candles.length < 3) return "Neutral";
    const last = candles[candles.length - 1], prev = candles[candles.length - 2];
    const lOpen = parseFloat(last[1]), lHigh = parseFloat(last[2]), lLow = parseFloat(last[3]), lClose = parseFloat(last[4]);
    const pOpen = parseFloat(prev[1]), pClose = parseFloat(prev[4]);

    const isLGreen = lClose > lOpen, isLRed = lClose < lOpen;
    const isPGreen = pClose > pOpen, isPRed = pClose < pOpen;

    if (isPRed && isLGreen && lClose > pOpen && lOpen < pClose) return "Bullish Engulfing 🟢 (Strong Buy)";
    if (isPGreen && isLRed && lClose < pOpen && lOpen > pClose) return "Bearish Engulfing 🔴 (Strong Sell)";
    
    const lBody = Math.abs(lClose - lOpen);
    const lLowerWick = isLGreen ? lOpen - lLow : lClose - lLow;
    const lUpperWick = isLGreen ? lHigh - lClose : lHigh - lOpen;
    
    if (lLowerWick > lBody * 2 && lUpperWick < lBody * 0.5) return "Hammer 🟢 (Reversal Up)";
    if (lUpperWick > lBody * 2 && lLowerWick < lBody * 0.5) return "Shooting Star 🔴 (Reversal Down)";

    return "Neutral";
}

module.exports = { calculateRSI, calculateEMA, calculateATR, checkDivergence, checkCandlePattern };
