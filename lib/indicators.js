function calculateRSI(candles, period = 14) {
    let gains = 0,
        losses = 0;
    for (let i = candles.length - period - 1; i < candles.length - 1; i++) {
        let change = parseFloat(candles[i + 1][4]) - parseFloat(candles[i][4]);
        if (change > 0) gains += change;
        else losses -= change;
    }
    let rs = (gains / period) / (losses / period || 1);
    return (100 - (100 / (1 + rs))).toFixed(2);
}

function calculateEMA(candles, period = 50) {
    if (candles.length < period) return null;
    const k = 2 / (period + 1);
    let ema = parseFloat(candles[0][4]);
    for (let i = 1; i < candles.length; i++) {
        ema = (parseFloat(candles[i][4]) * k) + (ema * (1 - k));
    }
    return ema.toFixed(2);
}

// 🚀 අලුතින් එකතු කළ ATR (Average True Range) සූත්‍රය
function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    let trs = [];
    for (let i = 1; i < candles.length; i++) {
        let high = parseFloat(candles[i][2]);
        let low = parseFloat(candles[i][3]);
        let prevClose = parseFloat(candles[i - 1][4]);
        
        // True Range ගණනය කිරීම
        let tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trs.push(tr);
    }
    
    // TR වල සාමාන්‍යය (Average) ගැනීම
    let atrSum = 0;
    for (let i = trs.length - period; i < trs.length; i++) {
        atrSum += trs[i];
    }
    return (atrSum / period).toFixed(4);
}

module.exports = { calculateRSI, calculateEMA, calculateATR }; // අලුත් එක Export කළා