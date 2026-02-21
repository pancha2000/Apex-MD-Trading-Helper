function analyzeSMC(candles) {
    let highs = candles.map(c => parseFloat(c[2]));
    let lows = candles.map(c => parseFloat(c[3]));
    let resistance = Math.max(...highs).toFixed(2);
    let support = Math.min(...lows).toFixed(2);

    let bullishFVG = "None", bearishFVG = "None";
    for (let i = candles.length - 20; i < candles.length - 1; i++) {
        if (i < 2) continue;
        let c1High = parseFloat(candles[i-2][2]), c3Low = parseFloat(candles[i][3]);
        let c1Low = parseFloat(candles[i-2][3]), c3High = parseFloat(candles[i][2]);
        if (c1High < c3Low) bullishFVG = `$${c1High.toFixed(2)} - $${c3Low.toFixed(2)}`;
        if (c1Low > c3High) bearishFVG = `$${c3High.toFixed(2)} - $${c1Low.toFixed(2)}`;
    }
    
    let maxPrice = Math.max(...highs), minPrice = Math.min(...lows), diff = maxPrice - minPrice;
    let fib618 = (maxPrice - (diff * 0.618)).toFixed(2);
    let fib786 = (maxPrice - (diff * 0.786)).toFixed(2);
    
    return { support, resistance, bullishFVG, bearishFVG, fib618, fib786 };
}
module.exports = { analyzeSMC };
