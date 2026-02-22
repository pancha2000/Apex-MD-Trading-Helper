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

function checkChoCH(candles) {
    if (candles.length < 15) return "None";
    const close = parseFloat(candles[candles.length - 1][4]);
    const recentHigh = Math.max(...candles.slice(-15, -2).map(c => parseFloat(c[2])));
    const recentLow = Math.min(...candles.slice(-15, -2).map(c => parseFloat(c[3])));

    if (close > recentHigh) return "Bullish ChoCH 🟢 (Reversal Up)";
    if (close < recentLow) return "Bearish ChoCH 🔴 (Reversal Down)";
    return "None";
}

// 🚀 අලුත්: ICT Kill Zones (Trading Sessions)
function getKillZone() {
    const utcHour = new Date().getUTCHours();
    // UTC 07:00-10:00 (London), UTC 13:00-16:00 (New York), UTC 00:00-06:00 (Asia)
    if (utcHour >= 7 && utcHour < 10) return "London Open 🇬🇧 (High Volatility)";
    if (utcHour >= 13 && utcHour < 16) return "New York Open 🇺🇸 (Max Volatility & Reversals)";
    if (utcHour >= 0 && utcHour < 6) return "Asian Session 🇯🇵 (Consolidation/Fakeouts)";
    return "Off-Peak Hours 🕰️ (Medium Volatility)";
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
    
    // 🚀 අලුත්: Order Blocks (OB) හඳුනාගැනීම
    let bullishOB = "None", bearishOB = "None";
    for (let i = candles.length - 15; i < candles.length - 2; i++) {
        let isRed = parseFloat(candles[i][4]) < parseFloat(candles[i][1]);
        let isGreen = parseFloat(candles[i][4]) > parseFloat(candles[i][1]);
        
        // Bullish OB: අන්තිම රතු කැන්ඩල් එකට පස්සේ ලොකු කොළ කැන්ඩල් 2ක්
        if (isRed && parseFloat(candles[i+1][4]) > parseFloat(candles[i+1][1]) && parseFloat(candles[i+2][4]) > parseFloat(candles[i+1][2])) {
            bullishOB = `$${parseFloat(candles[i][3]).toFixed(2)} - $${parseFloat(candles[i][1]).toFixed(2)}`;
        }
        // Bearish OB: අන්තිම කොළ කැන්ඩල් එකට පස්සේ ලොකු රතු කැන්ඩල් 2ක්
        if (isGreen && parseFloat(candles[i+1][4]) < parseFloat(candles[i+1][1]) && parseFloat(candles[i+2][4]) < parseFloat(candles[i+1][3])) {
            bearishOB = `$${parseFloat(candles[i][1]).toFixed(2)} - $${parseFloat(candles[i][2]).toFixed(2)}`;
        }
    }

    let maxPrice = resistance;
    let minPrice = support;
    let diff = maxPrice - minPrice;
    
    let fib618 = (maxPrice - (diff * 0.618)).toFixed(2);
    let fib786 = (maxPrice - (diff * 0.786)).toFixed(2);
    let ext1618 = (maxPrice + (diff * 0.618)).toFixed(2);
    let ext2618 = (maxPrice + (diff * 1.618)).toFixed(2);
    let extMinus1618 = (minPrice - (diff * 0.618)).toFixed(2);

    let recentCandles = candles.slice(-15);
    let swingHigh = Math.max(...recentCandles.map(c => parseFloat(c[2]))).toFixed(2);
    let swingLow = Math.min(...recentCandles.map(c => parseFloat(c[3]))).toFixed(2);

    let sweep = checkLiquiditySweep(candles);
    let choch = checkChoCH(candles);
    let killzone = getKillZone(); // 👈 අලුත් Session එක

    return { 
        support: support.toFixed(2), resistance: resistance.toFixed(2), 
        bullishFVG, bearishFVG, 
        bullishOB, bearishOB, // 👈 අලුත් Order Blocks
        fib618, fib786, ext1618, ext2618, extMinus1618, 
        swingHigh, swingLow, sweep, choch, killzone
    };
}
module.exports = { analyzeSMC };
