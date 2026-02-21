// RSI ගණනය කිරීම
function calculateRSI(candles, period = 14) {
    let gains = 0, losses = 0;
    for (let i = candles.length - period - 1; i < candles.length - 1; i++) {
        let change = parseFloat(candles[i+1][4]) - parseFloat(candles[i][4]);
        if (change > 0) gains += change;
        else losses -= change;
    }
    let rs = (gains / period) / (losses / period || 1);
    return (100 - (100 / (1 + rs))).toFixed(2);
}

// EMA (Exponential Moving Average) ගණනය කිරීම (Trend එක හඳුනාගැනීමට)
function calculateEMA(candles, period = 50) {
    if (candles.length < period) return null;
    const k = 2 / (period + 1);
    let ema = parseFloat(candles[0][4]); 
    for (let i = 1; i < candles.length; i++) {
        ema = (parseFloat(candles[i][4]) * k) + (ema * (1 - k));
    }
    return ema.toFixed(2);
}

module.exports = { calculateRSI, calculateEMA };
