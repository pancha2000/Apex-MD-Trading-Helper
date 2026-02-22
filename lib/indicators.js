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

function checkCandlePattern(candles) {
    if (candles.length < 3) return "Neutral";
    const last = candles[candles.length - 1], prev = candles[candles.length - 2];
    const lOpen = parseFloat(last[1]), lHigh = parseFloat(last[2]), lLow = parseFloat(last[3]), lClose = parseFloat(last[4]);
    const pOpen = parseFloat(prev[1]), pClose = parseFloat(prev[4]);
    const isLGreen = lClose > lOpen, isLRed = lClose < lOpen;
    const isPGreen = pClose > pOpen, isPRed = pClose < pOpen;

    if (isPRed && isLGreen && lClose > pOpen && lOpen < pClose) return "Bullish Engulfing 🟢";
    if (isPGreen && isLRed && lClose < pOpen && lOpen > pClose) return "Bearish Engulfing 🔴";
    
    const lBody = Math.abs(lClose - lOpen);
    const lLowerWick = isLGreen ? lOpen - lLow : lClose - lLow;
    const lUpperWick = isLGreen ? lHigh - lClose : lHigh - lOpen;
    
    if (lLowerWick > lBody * 2 && lUpperWick < lBody * 0.5) return "Hammer 🟢";
    if (lUpperWick > lBody * 2 && lLowerWick < lBody * 0.5) return "Shooting Star 🔴";
    return "Neutral";
}

function calculatePOC(candles) {
    if (candles.length < 10) return "Unknown";
    let bins = 20; 
    let maxPrice = Math.max(...candles.map(c => parseFloat(c[2])));
    let minPrice = Math.min(...candles.map(c => parseFloat(c[3])));
    let binSize = (maxPrice - minPrice) / bins;
    if (binSize === 0) return maxPrice.toFixed(2);

    let volumeProfile = new Array(bins).fill(0);
    for (let c of candles) {
        let typicalPrice = (parseFloat(c[2]) + parseFloat(c[3]) + parseFloat(c[4])) / 3;
        let volume = parseFloat(c[5]);
        let binIndex = Math.floor((typicalPrice - minPrice) / binSize);
        if (binIndex >= bins) binIndex = bins - 1;
        volumeProfile[binIndex] += volume;
    }
    let maxVolIndex = volumeProfile.indexOf(Math.max(...volumeProfile));
    let pocPrice = minPrice + (maxVolIndex * binSize) + (binSize / 2);
    return pocPrice.toFixed(2);
}

function calculateMACD(candles) {
    if (candles.length < 35) return "Unknown";
    let ema12 = calculateEMA(candles, 12);
    let ema26 = calculateEMA(candles, 26);
    if (!ema12 || !ema26) return "Unknown";
    let macdLine = parseFloat(ema12) - parseFloat(ema26);
    return macdLine > 0 ? `Bullish 🟢 (${macdLine.toFixed(2)})` : `Bearish 🔴 (${macdLine.toFixed(2)})`;
}

// 🚀 අලුත්: VWAP (Day Trading වල රජා)
function calculateVWAP(candles) {
    if (candles.length < 10) return "Unknown";
    let cumTypPriceVol = 0, cumVol = 0;
    for (let c of candles) {
        let typicalPrice = (parseFloat(c[2]) + parseFloat(c[3]) + parseFloat(c[4])) / 3;
        let volume = parseFloat(c[5]);
        cumTypPriceVol += typicalPrice * volume;
        cumVol += volume;
    }
    let vwap = cumTypPriceVol / cumVol;
    let lastClose = parseFloat(candles[candles.length - 1][4]);
    return lastClose > vwap ? `Above VWAP 🟢 ($${vwap.toFixed(2)})` : `Below VWAP 🔴 ($${vwap.toFixed(2)})`;
}

// 🚀 අලුත්: Volume Breakout Filter (Fakeouts අඳුරගැනීම)
function checkVolumeBreakout(candles) {
    if (candles.length < 25) return "Consolidating";
    let vols = candles.map(c => parseFloat(c[5]));
    let avgVol = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20; // සාමාන්‍ය Volume එක
    let lastVol = vols[vols.length - 1];
    let lastClose = parseFloat(candles[candles.length - 1][4]);
    
    let prevHigh = Math.max(...candles.slice(-21, -1).map(c => parseFloat(c[2])));
    let prevLow = Math.min(...candles.slice(-21, -1).map(c => parseFloat(c[3])));

    if (lastClose > prevHigh && lastVol > avgVol * 1.5) return "Bullish Breakout 🚀 (High Volume)";
    if (lastClose < prevLow && lastVol > avgVol * 1.5) return "Bearish Breakout 🩸 (High Volume)";
    if (lastClose > prevHigh || lastClose < prevLow) return "Fakeout Warning ⚠️ (Low Volume Breakout)";
    
    return "Consolidating ⏳";
}

module.exports = { calculateRSI, calculateEMA, calculateATR, checkDivergence, checkCandlePattern, calculatePOC, calculateMACD, calculateVWAP, checkVolumeBreakout };
