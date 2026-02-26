// ============================================================
// ✅ UPGRADED smartmoney.js - 4 Decimal Precision Update
// Added: Harmonic Pattern Entry Support (VIP Priority)
// ============================================================

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

function getKillZone() {
    const utcHour = new Date().getUTCHours();
    if (utcHour >= 7 && utcHour < 10) return "London Open 🇬🇧 (High Volatility)";
    if (utcHour >= 13 && utcHour < 16) return "New York Open 🇺🇸 (Max Volatility)";
    if (utcHour >= 0 && utcHour < 6) return "Asian Session 🇯🇵 (Consolidation/Fakeouts)";
    return "Off-Peak Hours 🕰️ (Medium Volatility)";
}

function detectOrderBlocks(candles) {
    let bullishOB = null, bearishOB = null;
    for (let i = candles.length - 15; i < candles.length - 2; i++) {
        if (i < 0) continue;
        let isRed = parseFloat(candles[i][4]) < parseFloat(candles[i][1]);
        let isGreen = parseFloat(candles[i][4]) > parseFloat(candles[i][1]);
        
        if (isRed && parseFloat(candles[i+1][4]) > parseFloat(candles[i+1][1]) && parseFloat(candles[i+2][4]) > parseFloat(candles[i+1][2])) {
            const bottom = parseFloat(candles[i][3]), top = parseFloat(candles[i][1]), mid = ((bottom + top) / 2);
            bullishOB = { bottom: bottom.toFixed(4), top: top.toFixed(4), mid: mid.toFixed(4), display: `$${bottom.toFixed(4)} - $${top.toFixed(4)}`, sl: (bottom * 0.998).toFixed(4) };
        }
        if (isGreen && parseFloat(candles[i+1][4]) < parseFloat(candles[i+1][1]) && parseFloat(candles[i+2][4]) < parseFloat(candles[i+1][3])) {
            const bottom = parseFloat(candles[i][1]), top = parseFloat(candles[i][2]), mid = ((bottom + top) / 2);
            bearishOB = { bottom: bottom.toFixed(4), top: top.toFixed(4), mid: mid.toFixed(4), display: `$${bottom.toFixed(4)} - $${top.toFixed(4)}`, sl: (top * 1.002).toFixed(4) };
        }
    }
    return { bullishOB, bearishOB };
}

function checkOBConfirmation(candles, ob, direction) {
    if (!ob) return { confirmed: false, status: "No OB Zone" };
    const last = candles[candles.length - 1], prev = candles[candles.length - 2];
    const lastClose = parseFloat(last[4]), lastLow = parseFloat(last[3]), lastHigh = parseFloat(last[2]), lastOpen = parseFloat(last[1]);
    const prevClose = parseFloat(prev[4]), prevOpen = parseFloat(prev[1]);
    const obBottom = parseFloat(ob.bottom), obTop = parseFloat(ob.top);

    if (direction === 'LONG') {
        const inZone = lastLow <= obTop && lastLow >= obBottom * 0.998;
        if (!inZone) return { confirmed: false, status: `⏳ PENDING - Limit Order set කරන්න.`, orderType: "LIMIT" };
        if (lastClose > lastOpen && lastClose > prevClose) return { confirmed: true, status: `✅ CONFIRMED - OB touch + Bullish close`, orderType: "MARKET" };
        return { confirmed: false, status: `⚠️ ZONE TOUCHED - Wait for confirmation`, orderType: "WAIT_CONFIRM" };
    } else {
        const inZone = lastHigh >= obBottom && lastHigh <= obTop * 1.002;
        if (!inZone) return { confirmed: false, status: `⏳ PENDING - Limit Order set කරන්න.`, orderType: "LIMIT" };
        if (lastClose < lastOpen && lastClose < prevClose) return { confirmed: true, status: `✅ CONFIRMED - OB touch + Bearish close`, orderType: "MARKET" };
        return { confirmed: false, status: `⚠️ ZONE TOUCHED - Wait for confirmation`, orderType: "WAIT_CONFIRM" };
    }
}

// ✅ FIX: Added 'harmonic' parameter to Best Entry Selection
function selectBestEntry(currentPrice, ob, fib618, poc, vwapPrice, direction, atr, harmonic = "None") {
    const price = parseFloat(currentPrice), atrVal = parseFloat(atr) || 0;
    let candidates = [];
    
    if (direction === 'LONG') {
        // 🔥 VIP Priority 0: Harmonic Pattern PRZ (Potential Reversal Zone)
        if (harmonic !== "None" && harmonic.includes("Bullish")) {
            candidates.push({ name: `${harmonic} PRZ Zone 🔥`, price: price, zoneBottom: price - atrVal * 0.5, zoneTop: price + atrVal * 0.2, sl: price - atrVal * 1.5, priority: 0 });
        }
        
        if (ob) candidates.push({ name: "Bullish OB", price: parseFloat(ob.mid), zoneBottom: parseFloat(ob.bottom), zoneTop: parseFloat(ob.top), sl: parseFloat(ob.sl), priority: 1 });
        if (fib618 && parseFloat(fib618) < price * 1.01) candidates.push({ name: "Fib 61.8%", price: parseFloat(fib618), zoneBottom: parseFloat(fib618) - atrVal * 0.3, zoneTop: parseFloat(fib618) + atrVal * 0.3, sl: (parseFloat(fib618) - atrVal * 1.5), priority: 2 });
        if (poc && parseFloat(poc) < price * 1.01) candidates.push({ name: "POC", price: parseFloat(poc), zoneBottom: parseFloat(poc) - atrVal * 0.3, zoneTop: parseFloat(poc) + atrVal * 0.3, sl: (parseFloat(poc) - atrVal * 1.5), priority: 3 });
        
        if (candidates.length === 0) return { name: "Current Price", price: price, zoneBottom: price - atrVal * 0.5, zoneTop: price, sl: price - atrVal * 1.5, priority: 5, warning: "⚠️ Strong zone නොමැත." };
        
        const best = candidates.sort((a, b) => a.priority - b.priority)[0];
        return best;
    } else {
        // 🔥 VIP Priority 0: Harmonic Pattern PRZ
        if (harmonic !== "None" && harmonic.includes("Bearish")) {
            candidates.push({ name: `${harmonic} PRZ Zone 🔥`, price: price, zoneBottom: price - atrVal * 0.2, zoneTop: price + atrVal * 0.5, sl: price + atrVal * 1.5, priority: 0 });
        }
        
        if (ob) candidates.push({ name: "Bearish OB", price: parseFloat(ob.mid), zoneBottom: parseFloat(ob.bottom), zoneTop: parseFloat(ob.top), sl: parseFloat(ob.sl), priority: 1 });
        if (fib618 && parseFloat(fib618) > price * 0.99) candidates.push({ name: "Fib 61.8%", price: parseFloat(fib618), zoneBottom: parseFloat(fib618) - atrVal * 0.3, zoneTop: parseFloat(fib618) + atrVal * 0.3, sl: (parseFloat(fib618) + atrVal * 1.5), priority: 2 });
        if (poc && parseFloat(poc) > price * 0.99) candidates.push({ name: "POC", price: parseFloat(poc), zoneBottom: parseFloat(poc) - atrVal * 0.3, zoneTop: parseFloat(poc) + atrVal * 0.3, sl: (parseFloat(poc) + atrVal * 1.5), priority: 3 });
        
        if (candidates.length === 0) return { name: "Current Price", price: price, zoneBottom: price, zoneTop: price + atrVal * 0.5, sl: price + atrVal * 1.5, priority: 5, warning: "⚠️ Strong zone නොමැත." };
        
        const best = candidates.sort((a, b) => a.priority - b.priority)[0];
        return best;
    }
}

function getOrderTypeSuggestion(entryPrice, currentPrice, direction) {
    const entry = parseFloat(entryPrice), current = parseFloat(currentPrice);
    const diffPct = Math.abs(entry - current) / current * 100;
    if (direction === 'LONG') {
        if (entry >= current * 0.999) return { type: "MARKET ORDER 🟢", reason: "Market Order use කළ හැකිය." };
        else if (diffPct <= 2) return { type: "LIMIT ORDER ⏳", reason: `Limit Order set කරන්න.` };
        else return { type: "LIMIT ORDER ⏳", reason: `OB zone retest වෙනකල් wait කරන්න.` };
    } else {
        if (entry <= current * 1.001) return { type: "MARKET ORDER 🔴", reason: "Market Order use කළ හැකිය." };
        else if (diffPct <= 2) return { type: "LIMIT ORDER ⏳", reason: `Limit Order set කරන්න.` };
        else return { type: "LIMIT ORDER ⏳", reason: `OB zone retest වෙනකල් wait කරන්න.` };
    }
}

function analyzeSMC(candles) {
    let highs = candles.map(c => parseFloat(c[2])), lows = candles.map(c => parseFloat(c[3]));
    let resistance = Math.max(...highs), support = Math.min(...lows), diff = resistance - support;
    let bullishFVG = "None", bearishFVG = "None";
    for (let i = candles.length - 20; i < candles.length - 1; i++) {
        if (i < 2) continue;
        let c1High = parseFloat(candles[i-2][2]), c3Low = parseFloat(candles[i][3]);
        let c1Low = parseFloat(candles[i-2][3]), c3High = parseFloat(candles[i][2]);
        if (c1High < c3Low) bullishFVG = `$${c1High.toFixed(4)} - $${c3Low.toFixed(4)}`;
        if (c1Low > c3High) bearishFVG = `$${c3High.toFixed(4)} - $${c1Low.toFixed(4)}`;
    }
    const { bullishOB, bearishOB } = detectOrderBlocks(candles);
    return {
        support: support.toFixed(4), resistance: resistance.toFixed(4),
        bullishFVG, bearishFVG, bullishOB, bearishOB,
        bullishOBDisplay: bullishOB ? bullishOB.display : "None",
        bearishOBDisplay: bearishOB ? bearishOB.display : "None",
        fib618: (resistance - (diff * 0.618)).toFixed(4),
        fib786: (resistance - (diff * 0.786)).toFixed(4),
        ext1618: (resistance + (diff * 0.618)).toFixed(4),
        ext2618: (resistance + (diff * 1.618)).toFixed(4),
        extMinus1618: (support - (diff * 0.618)).toFixed(4),
        swingHigh: Math.max(...candles.slice(-15).map(c => parseFloat(c[2]))).toFixed(4),
        swingLow: Math.min(...candles.slice(-15).map(c => parseFloat(c[3]))).toFixed(4),
        sweep: checkLiquiditySweep(candles), choch: checkChoCH(candles), killzone: getKillZone()
    };
}

module.exports = { analyzeSMC, detectOrderBlocks, checkOBConfirmation, selectBestEntry, getOrderTypeSuggestion };
