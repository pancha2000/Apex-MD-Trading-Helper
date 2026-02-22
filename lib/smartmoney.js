// 🚀 Liquidity Sweeps (Retail SL දඩයම් කිරීම)
function checkLiquiditySweep(candles) {
    if (candles.length < 5) return "None";
    const last = candles[candles.length - 1];
    const lOpen = parseFloat(last[1]), lHigh = parseFloat(last[2]), lLow = parseFloat(last[3]), lClose = parseFloat(last[4]);
    const prevLow = Math.min(...candles.slice(-10, -1).map(c => parseFloat(c[3])));
    const prevHigh = Math.max(...candles.slice(-10, -1).map(c => parseFloat(c[2])));

    if (lLow < prevLow && Math.min(lOpen, lClose) > prevLow) return "Bullish Sweep 🟢 (Sell-side Liquidity Taken)";
    if (lHigh > prevHigh && Math.max(lOpen, lClose) < prevHigh) return "Bearish Sweep 🔴 (Buy-side Liquidity Taken)";
    return "None";
}

// 🚀 Change of Character (ChoCH) - Trend වෙනස් වීම
function checkChoCH(candles) {
    if (candles.length < 15) return "None";
    const close = parseFloat(candles[candles.length - 1][4]);
    const recentHigh = Math.max(...candles.slice(-15, -2).map(c => parseFloat(c[2])));
    const recentLow = Math.min(...candles.slice(-15, -2).map(c => parseFloat(c[3])));

    if (close > recentHigh) return "Bullish ChoCH 🟢 (Trend Reversal Up)";
    if (close < recentLow) return "Bearish ChoCH 🔴 (Trend Reversal Down)";
    return "None";
}

// 👑 ප්‍රධාන SMC විශ්ලේෂණ Function එක
function analyzeSMC(candles) {
    let highs = candles.map(c => parseFloat(c[2]));
    let lows = candles.map(c => parseFloat(c[3]));
    let resistance = Math.max(...highs);
    let support = Math.min(...lows);

    let bullishFVG = "None", bearishFVG = "None";
    for (let i = candles.length - 20; i < candles.length - 1; i++) {
        if (i < 2) continue;
        let c1High = parseFloat(candles[i-2][2]), c3Low = parseFloat(candles[i][3]);
        let c1Low = parseFloat(candles[i-2][3]), c3High = parseFloat(candles[i][2]);
        if (c1High < c3Low) bullishFVG = `$${c1High.toFixed(2)} - $${c3Low.toFixed(2)}`;
        if (c1Low > c3High) bearishFVG = `$${c3High.toFixed(2)} - $${c1Low.toFixed(2)}`;
    }
    
    let maxPrice = resistance;
    let minPrice = support;
    let diff = maxPrice - minPrice;
    
    // Golden Pocket (Fibonacci)
    let fib618 = (maxPrice - (diff * 0.618)).toFixed(2);
    let fib786 = (maxPrice - (diff * 0.786)).toFixed(2);

    // Fibonacci Extensions (Targets)
    let ext1618 = (maxPrice + (diff * 0.618)).toFixed(2);
    let ext2618 = (maxPrice + (diff * 1.618)).toFixed(2);
    let extMinus1618 = (minPrice - (diff * 0.618)).toFixed(2);

    // Recent Swings (For Stop Loss)
    let recentCandles = candles.slice(-15);
    let swingHigh = Math.max(...recentCandles.map(c => parseFloat(c[2]))).toFixed(2);
    let swingLow = Math.min(...recentCandles.map(c => parseFloat(c[3]))).toFixed(2);

    // 🎯 අලුත් SMC දත්ත (Sweep සහ ChoCH)
    let sweep = checkLiquiditySweep(candles);
    let choch = checkChoCH(candles);

    return { 
        support: support.toFixed(2), 
        resistance: resistance.toFixed(2), 
        bullishFVG, 
        bearishFVG, 
        fib618, 
        fib786, 
        ext1618, 
        ext2618, 
        extMinus1618, 
        swingHigh, 
        swingLow,
        sweep, // 👈 දැන් මේවා එන්නේ SMC එකෙන්!
        choch  // 👈
    };
}
module.exports = { analyzeSMC };
