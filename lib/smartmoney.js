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
    
    // Golden Pocket
    let fib618 = (maxPrice - (diff * 0.618)).toFixed(2);
    let fib786 = (maxPrice - (diff * 0.786)).toFixed(2);

    // 🚀 Fibonacci Extensions (මිල අහසට හෝ පාතාලයට යද්දී Targets)
    let ext1618 = (maxPrice + (diff * 0.618)).toFixed(2);
    let ext2618 = (maxPrice + (diff * 1.618)).toFixed(2);
    let extMinus1618 = (minPrice - (diff * 0.618)).toFixed(2);

    // 🛡️ Recent Swings (Smart Stop Loss සඳහා අන්තිමට හැරුණු තැන්)
    let recentCandles = candles.slice(-15);
    let swingHigh = Math.max(...recentCandles.map(c => parseFloat(c[2]))).toFixed(2);
    let swingLow = Math.min(...recentCandles.map(c => parseFloat(c[3]))).toFixed(2);
    
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
        swingLow 
    };
}
module.exports = { analyzeSMC };
