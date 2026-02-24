// ============================================================
// ✅ FIXED smartmoney.js - Entry System Rewrite
// Fixes: OB Midpoint Entry, Best Zone Selection, Proper SL
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
    if (utcHour >= 13 && utcHour < 16) return "New York Open 🇺🇸 (Max Volatility & Reversals)";
    if (utcHour >= 0 && utcHour < 6) return "Asian Session 🇯🇵 (Consolidation/Fakeouts)";
    return "Off-Peak Hours 🕰️ (Medium Volatility)";
}

// ============================================================
// ✅ FIX 1: OB Detection - Full zone data (bottom, top, midpoint)
// කලින්: bottom price පමණක් → දැන්: zone object සම්පූර්ණයෙන්
// ============================================================
function detectOrderBlocks(candles) {
    let bullishOB = null, bearishOB = null;

    for (let i = candles.length - 15; i < candles.length - 2; i++) {
        if (i < 0) continue;
        let isRed = parseFloat(candles[i][4]) < parseFloat(candles[i][1]);
        let isGreen = parseFloat(candles[i][4]) > parseFloat(candles[i][1]);

        // Bullish OB: Red candle → 2 strong green candles
        if (isRed &&
            parseFloat(candles[i+1][4]) > parseFloat(candles[i+1][1]) &&
            parseFloat(candles[i+2][4]) > parseFloat(candles[i+1][2])) {

            const bottom = parseFloat(candles[i][3]);
            const top = parseFloat(candles[i][1]);
            const mid = ((bottom + top) / 2);
            bullishOB = {
                bottom: bottom.toFixed(2),
                top: top.toFixed(2),
                mid: mid.toFixed(2),
                display: `$${bottom.toFixed(2)} - $${top.toFixed(2)}`,
                // ✅ FIX 3: SL = zone bottom - small buffer (zone invalidation)
                sl: (bottom * 0.998).toFixed(2)
            };
        }

        // Bearish OB: Green candle → 2 strong red candles
        if (isGreen &&
            parseFloat(candles[i+1][4]) < parseFloat(candles[i+1][1]) &&
            parseFloat(candles[i+2][4]) < parseFloat(candles[i+1][3])) {

            const bottom = parseFloat(candles[i][1]);
            const top = parseFloat(candles[i][2]);
            const mid = ((bottom + top) / 2);
            bearishOB = {
                bottom: bottom.toFixed(2),
                top: top.toFixed(2),
                mid: mid.toFixed(2),
                display: `$${bottom.toFixed(2)} - $${top.toFixed(2)}`,
                // ✅ FIX 3: SL = zone top + small buffer
                sl: (top * 1.002).toFixed(2)
            };
        }
    }

    return { bullishOB, bearishOB };
}

// ============================================================
// ✅ FIX 2: Confirmation Candle Check
// OB zone touch + candle close confirm check
// ============================================================
function checkOBConfirmation(candles, ob, direction) {
    if (!ob) return { confirmed: false, status: "No OB Zone" };

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const lastClose = parseFloat(last[4]);
    const lastLow = parseFloat(last[3]);
    const lastHigh = parseFloat(last[2]);
    const lastOpen = parseFloat(last[1]);
    const prevClose = parseFloat(prev[4]);
    const prevOpen = parseFloat(prev[1]);

    const obBottom = parseFloat(ob.bottom);
    const obTop = parseFloat(ob.top);

    if (direction === 'LONG') {
        // Price OB zone ට touch කළාද?
        const inZone = lastLow <= obTop && lastLow >= obBottom * 0.998;
        if (!inZone) {
            return {
                confirmed: false,
                status: `⏳ PENDING - Price OB Zone ($${ob.bottom}-$${ob.top}) ළඟට නොපැමිණෙයි. Limit Order set කරන්න.`,
                orderType: "LIMIT"
            };
        }
        // ✅ Bullish confirmation: zone touch කළ candle bullish close
        const isBullishClose = lastClose > lastOpen && lastClose > prevClose;
        const isHammer = (lastClose - lastOpen) > 0 && (lastOpen - lastLow) > Math.abs(lastClose - lastOpen) * 1.5;
        const isEngulfing = lastClose > prevOpen && lastOpen < prevClose && prevClose < prevOpen;

        if (isBullishClose || isHammer || isEngulfing) {
            return {
                confirmed: true,
                status: `✅ CONFIRMED - OB Zone touch + Bullish candle close. දැනම enter කළ හැකිය!`,
                orderType: "MARKET"
            };
        }
        return {
            confirmed: false,
            status: `⚠️ ZONE TOUCHED - Confirmation candle close වෙනකල් wait කරන්න. (Current candle bearish)`,
            orderType: "WAIT_CONFIRM"
        };
    }

    if (direction === 'SHORT') {
        const inZone = lastHigh >= obBottom && lastHigh <= obTop * 1.002;
        if (!inZone) {
            return {
                confirmed: false,
                status: `⏳ PENDING - Price OB Zone ($${ob.bottom}-$${ob.top}) ළඟට නොපැමිණෙයි. Limit Order set කරන්න.`,
                orderType: "LIMIT"
            };
        }
        const isBearishClose = lastClose < lastOpen && lastClose < prevClose;
        const isShootingStar = (lastOpen - lastClose) > 0 && (lastHigh - lastOpen) > Math.abs(lastClose - lastOpen) * 1.5;

        if (isBearishClose || isShootingStar) {
            return {
                confirmed: true,
                status: `✅ CONFIRMED - OB Zone touch + Bearish candle close. දැනම enter කළ හැකිය!`,
                orderType: "MARKET"
            };
        }
        return {
            confirmed: false,
            status: `⚠️ ZONE TOUCHED - Confirmation candle close වෙනකල් wait කරන්න. (Current candle bullish)`,
            orderType: "WAIT_CONFIRM"
        };
    }

    return { confirmed: false, status: "Unknown direction", orderType: "WAIT" };
}

// ============================================================
// ✅ FIX 5: Best Entry Zone Selector
// OB mid, Fib618, POC, VWAP - current price ට closest zone select
// ============================================================
function selectBestEntry(currentPrice, ob, fib618, poc, vwapPrice, direction, atr) {
    const price = parseFloat(currentPrice);
    const atrVal = parseFloat(atr) || 0;

    let candidates = [];

    if (direction === 'LONG') {
        // LONG candidates - price ට below/equal zones
        if (ob) {
            candidates.push({
                name: "Bullish OB Midpoint",
                price: parseFloat(ob.mid),
                zoneBottom: parseFloat(ob.bottom),
                zoneTop: parseFloat(ob.top),
                sl: parseFloat(ob.sl),
                priority: 1  // OB highest priority
            });
        }
        if (fib618 && parseFloat(fib618) < price * 1.01) {
            candidates.push({
                name: "Fib 61.8%",
                price: parseFloat(fib618),
                zoneBottom: parseFloat(fib618) - atrVal * 0.3,
                zoneTop: parseFloat(fib618) + atrVal * 0.3,
                sl: (parseFloat(fib618) - atrVal * 1.5),
                priority: 2
            });
        }
        if (poc && parseFloat(poc) < price * 1.01) {
            candidates.push({
                name: "Point of Control (POC)",
                price: parseFloat(poc),
                zoneBottom: parseFloat(poc) - atrVal * 0.3,
                zoneTop: parseFloat(poc) + atrVal * 0.3,
                sl: (parseFloat(poc) - atrVal * 1.5),
                priority: 3
            });
        }
        if (vwapPrice && vwapPrice > 0 && vwapPrice < price * 1.01) {
            candidates.push({
                name: "VWAP Support",
                price: vwapPrice,
                zoneBottom: vwapPrice - atrVal * 0.2,
                zoneTop: vwapPrice + atrVal * 0.2,
                sl: (vwapPrice - atrVal * 1.5),
                priority: 4
            });
        }

        if (candidates.length === 0) {
            // Fallback: current price ළඟ entry
            return {
                name: "Current Price (No Zone)",
                price: price,
                zoneBottom: price - atrVal * 0.5,
                zoneTop: price,
                sl: price - atrVal * 1.5,
                priority: 5,
                warning: "⚠️ Strong zone නොමැත. Entry risk ඉහළයි."
            };
        }

        // Priority 1 (OB) ඇත්නම් use කරනවා, නැත්නම් closest to current price
        const hasOB = candidates.find(c => c.priority === 1);
        if (hasOB) return hasOB;

        // Closest to current price select
        candidates.sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price));
        return candidates[0];
    }

    if (direction === 'SHORT') {
        if (ob) {
            candidates.push({
                name: "Bearish OB Midpoint",
                price: parseFloat(ob.mid),
                zoneBottom: parseFloat(ob.bottom),
                zoneTop: parseFloat(ob.top),
                sl: parseFloat(ob.sl),
                priority: 1
            });
        }
        if (fib618 && parseFloat(fib618) > price * 0.99) {
            candidates.push({
                name: "Fib 61.8% Resistance",
                price: parseFloat(fib618),
                zoneBottom: parseFloat(fib618) - atrVal * 0.3,
                zoneTop: parseFloat(fib618) + atrVal * 0.3,
                sl: (parseFloat(fib618) + atrVal * 1.5),
                priority: 2
            });
        }
        if (poc && parseFloat(poc) > price * 0.99) {
            candidates.push({
                name: "POC Resistance",
                price: parseFloat(poc),
                zoneBottom: parseFloat(poc) - atrVal * 0.3,
                zoneTop: parseFloat(poc) + atrVal * 0.3,
                sl: (parseFloat(poc) + atrVal * 1.5),
                priority: 3
            });
        }

        if (candidates.length === 0) {
            return {
                name: "Current Price (No Zone)",
                price: price,
                zoneBottom: price,
                zoneTop: price + atrVal * 0.5,
                sl: price + atrVal * 1.5,
                priority: 5,
                warning: "⚠️ Strong zone නොමැත. Entry risk ඉහළයි."
            };
        }

        const hasOB = candidates.find(c => c.priority === 1);
        if (hasOB) return hasOB;

        candidates.sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price));
        return candidates[0];
    }
}

// ============================================================
// ✅ FIX 4: Order Type Suggestion (Limit vs Market)
// Entry vs Current price distance අනුව auto decide
// ============================================================
function getOrderTypeSuggestion(entryPrice, currentPrice, direction) {
    const entry = parseFloat(entryPrice);
    const current = parseFloat(currentPrice);
    const diffPct = Math.abs(entry - current) / current * 100;

    if (direction === 'LONG') {
        if (entry >= current * 0.999) {
            return { type: "MARKET ORDER 🟢", reason: "Entry price දැනට current price ට ළඟයි. Market Order use කළ හැකිය." };
        } else if (diffPct <= 2) {
            return { type: "LIMIT ORDER ⏳", reason: `Entry ($${entry}) current ($${current}) ට ${diffPct.toFixed(2)}% පහළ. Limit Order set කරන්න.` };
        } else {
            return { type: "LIMIT ORDER ⏳ (Patience)", reason: `Entry ($${entry}) current ($${current}) ට ${diffPct.toFixed(2)}% දුරයි. OB zone retest වෙනකල් wait කරන්න.` };
        }
    }
    if (direction === 'SHORT') {
        if (entry <= current * 1.001) {
            return { type: "MARKET ORDER 🔴", reason: "Entry price දැනට current price ට ළඟයි. Market Order use කළ හැකිය." };
        } else if (diffPct <= 2) {
            return { type: "LIMIT ORDER ⏳", reason: `Entry ($${entry}) current ($${current}) ට ${diffPct.toFixed(2)}% ඉහළ. Limit Order set කරන්න.` };
        } else {
            return { type: "LIMIT ORDER ⏳ (Patience)", reason: `Entry ($${entry}) current ($${current}) ට ${diffPct.toFixed(2)}% දුරයි. OB zone retest වෙනකල් wait කරන්න.` };
        }
    }
    return { type: "WAIT", reason: "Direction unclear." };
}

// ============================================================
// ✅ Main SMC Analysis Function
// ============================================================
function analyzeSMC(candles) {
    let highs = candles.map(c => parseFloat(c[2]));
    let lows = candles.map(c => parseFloat(c[3]));
    let resistance = Math.max(...highs);
    let support = Math.min(...lows);

    // FVG Detection
    let bullishFVG = "None", bearishFVG = "None";
    for (let i = candles.length - 20; i < candles.length - 1; i++) {
        if (i < 2) continue;
        let c1High = parseFloat(candles[i-2][2]), c3Low = parseFloat(candles[i][3]);
        let c1Low = parseFloat(candles[i-2][3]), c3High = parseFloat(candles[i][2]);
        if (c1High < c3Low) bullishFVG = `$${c1High.toFixed(2)} - $${c3Low.toFixed(2)}`;
        if (c1Low > c3High) bearishFVG = `$${c3High.toFixed(2)} - $${c1Low.toFixed(2)}`;
    }

    // ✅ UPGRADED: Full OB objects (bottom, top, mid, sl)
    const { bullishOB, bearishOB } = detectOrderBlocks(candles);

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
    let killzone = getKillZone();

    return {
        support: support.toFixed(2), resistance: resistance.toFixed(2),
        bullishFVG, bearishFVG,
        bullishOB,   // ✅ Full object (bottom, top, mid, sl, display)
        bearishOB,   // ✅ Full object
        // Backward compat display strings
        bullishOBDisplay: bullishOB ? bullishOB.display : "None",
        bearishOBDisplay: bearishOB ? bearishOB.display : "None",
        fib618, fib786, ext1618, ext2618, extMinus1618,
        swingHigh, swingLow, sweep, choch, killzone
    };
}

module.exports = {
    analyzeSMC,
    detectOrderBlocks,
    checkOBConfirmation,
    selectBestEntry,
    getOrderTypeSuggestion
};