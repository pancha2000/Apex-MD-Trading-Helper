// ============================================================
// ✅ FIXED indicators.js - Apex MD Trading Helper
// Complete & Error-Free Version
// ============================================================

function calculateRSI(candles, period = 14) {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let change = parseFloat(candles[i][4]) - parseFloat(candles[i - 1][4]);
        if (change > 0) gains += change;
        else losses -= change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < candles.length; i++) {
        let change = parseFloat(candles[i][4]) - parseFloat(candles[i - 1][4]);
        avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
}

function calculateEMA(candles, period = 50, returnArray = false) {
    if (candles.length < period) return returnArray ? [] : 0;
    const k = 2 / (period + 1);
    let emaArray = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += parseFloat(candles[i][4]);
    let ema = sum / period;
    emaArray.push(ema);
    for (let i = period; i < candles.length; i++) {
        ema = (parseFloat(candles[i][4]) - ema) * k + ema;
        emaArray.push(ema);
    }
    return returnArray ? emaArray : ema.toFixed(4);
}

function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    let trSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        let high = parseFloat(candles[i][2]), low = parseFloat(candles[i][3]), prevClose = parseFloat(candles[i - 1][4]);
        let tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trSum += tr;
    }
    return (trSum / period).toFixed(4);
}

function checkDivergence(candles) {
    if (candles.length < 40) return "None";
    let currentPrice = parseFloat(candles[candles.length - 1][4]);
    let pastPrice = parseFloat(candles[candles.length - 20][4]);
    let currentRSI = calculateRSI(candles.slice(-25), 14);
    let pastRSI = calculateRSI(candles.slice(-40, -14), 14);
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
    return (minPrice + (maxVolIndex * binSize) + (binSize / 2)).toFixed(2);
}

function calculateMACD(candles) {
    if (candles.length < 35) return "Unknown";
    let ema12 = calculateEMA(candles.slice(-26), 12);
    let ema26 = calculateEMA(candles, 26);
    if (!ema12 || !ema26) return "Unknown";
    let macdLine = parseFloat(ema12) - parseFloat(ema26);
    return macdLine > 0 ? `Bullish 🟢 (${macdLine.toFixed(2)})` : `Bearish 🔴 (${macdLine.toFixed(2)})`;
}

function calculateVWAP(candles) {
    if (candles.length < 5) return "Unknown";
    const lastCandleTime = parseInt(candles[candles.length - 1][0]);
    const dayStart = new Date(new Date(lastCandleTime).setUTCHours(0, 0, 0, 0)).getTime();
    let dailyCandles = candles.filter(c => parseInt(c[0]) >= dayStart);
    if (dailyCandles.length < 3) dailyCandles = candles.slice(-20);
    let cumTypPriceVol = 0, cumVol = 0;
    for (let c of dailyCandles) {
        let typicalPrice = (parseFloat(c[2]) + parseFloat(c[3]) + parseFloat(c[4])) / 3;
        let volume = parseFloat(c[5]);
        cumTypPriceVol += typicalPrice * volume;
        cumVol += volume;
    }
    if (cumVol === 0) return "Unknown";
    let vwap = cumTypPriceVol / cumVol;
    let lastClose = parseFloat(candles[candles.length - 1][4]);
    return lastClose > vwap ? `Above VWAP 🟢 ($${vwap.toFixed(2)})` : `Below VWAP 🔴 ($${vwap.toFixed(2)})`;
}

function checkVolumeBreakout(candles) {
    if (candles.length < 25) return "Consolidating";
    let vols = candles.map(c => parseFloat(c[5]));
    let avgVol = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    let lastVol = vols[vols.length - 1];
    let lastClose = parseFloat(candles[candles.length - 1][4]);
    let prevHigh = Math.max(...candles.slice(-21, -1).map(c => parseFloat(c[2])));
    let prevLow = Math.min(...candles.slice(-21, -1).map(c => parseFloat(c[3])));
    if (lastClose > prevHigh && lastVol > avgVol * 1.5) return "Bullish Breakout 🚀 (High Volume)";
    if (lastClose < prevLow && lastVol > avgVol * 1.5) return "Bearish Breakout 🩸 (High Volume)";
    if (lastClose > prevHigh || lastClose < prevLow) return "Fakeout Warning ⚠️ (Low Volume Breakout)";
    return "Consolidating ⏳";
}

function validateEntryPoint(entryPrice, currentPrice, direction) {
    const entry = parseFloat(entryPrice), current = parseFloat(currentPrice);
    const diff = Math.abs(entry - current) / current * 100;
    if (direction === 'LONG') {
        if (entry > current * 1.005) return { valid: false, warning: `⚠️ *ENTRY WARNING:* Signal Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% ඉහළයි! Market Order ගන්න එපා.` };
        if (entry < current * 0.97) return { valid: true, warning: `⏳ *ENTRY NOTE:* Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% පහළයි. Limit Order set කරන්න.` };
    }
    if (direction === 'SHORT') {
        if (entry < current * 0.995) return { valid: false, warning: `⚠️ *ENTRY WARNING:* Signal Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% පහළයි! Market Order ගන්න එපා.` };
        if (entry > current * 1.03) return { valid: true, warning: `⏳ *ENTRY NOTE:* Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% ඉහළයි.` };
    }
    return { valid: true, warning: "" };
}

function confirmEntry5m(candles5m, direction) {
    if (!candles5m || candles5m.length < 20) return { confirmed: false, score: 0, reason: "5m data insufficient" };
    const rsi5m = calculateRSI(candles5m.slice(-20), 14);
    const ema21_5m = parseFloat(calculateEMA(candles5m.slice(-25), 21));
    const pattern5m = checkCandlePattern(candles5m.slice(-5));
    const lastClose = parseFloat(candles5m[candles5m.length - 1][4]);
    const lastOpen = parseFloat(candles5m[candles5m.length - 1][1]);
    const prevClose = parseFloat(candles5m[candles5m.length - 2][4]);

    let score = 0, reasons = [], warnings = [];
    if (direction === 'LONG') {
        if (lastClose > ema21_5m) { score++; reasons.push("5m above EMA21"); } else warnings.push("5m below EMA21 ⚠️");
        if (rsi5m > 25 && rsi5m < 60) { score++; reasons.push(`5m RSI ok (${rsi5m})`); } else warnings.push(`5m RSI warning (${rsi5m})`);
        if (lastClose > lastOpen) { score++; reasons.push("5m bullish candle"); } else warnings.push("5m bearish candle");
        if (pattern5m.includes('🟢')) { score++; reasons.push(`5m ${pattern5m}`); }
        if (lastClose > prevClose) { score++; reasons.push("5m momentum up"); }
    } else { 
        if (lastClose < ema21_5m) { score++; reasons.push("5m below EMA21"); } else warnings.push("5m above EMA21 ⚠️");
        if (rsi5m > 40 && rsi5m < 75) { score++; reasons.push(`5m RSI ok (${rsi5m})`); } else warnings.push(`5m RSI warning (${rsi5m})`);
        if (lastClose < lastOpen) { score++; reasons.push("5m bearish candle"); } else warnings.push("5m bullish candle");
        if (pattern5m.includes('🔴')) { score++; reasons.push(`5m ${pattern5m}`); }
        if (lastClose < prevClose) { score++; reasons.push("5m momentum down"); }
    }
    const confirmed = score >= 3;
    const status = confirmed ? `✅ 5m ALIGNED (${score}/5) - Entry confirmed!\n   ✔️ ${reasons.join(' | ')}` : `⚠️ 5m NOT ALIGNED (${score}/5) - Wait for 5m confirmation\n   ❌ ${warnings.join(' | ')}`;
    return { confirmed, score, maxScore: 5, reasons, warnings, status };
}

function checkRRR(entryPrice, tpPrice, slPrice, minRRR = 1.5) {
    const entry = parseFloat(entryPrice), tp = parseFloat(tpPrice), sl = parseFloat(slPrice);
    const reward = Math.abs(tp - entry), risk = Math.abs(entry - sl);
    if (risk === 0) return { pass: false, rrr: 0, reason: "SL = Entry! Risk is 0." };
    const rrr = reward / risk;
    const pass = rrr >= minRRR;
    return {
        pass, rrr: rrr.toFixed(2), reward: reward.toFixed(2), risk: risk.toFixed(2),
        reason: pass ? `✅ RRR 1:${rrr.toFixed(2)} ≥ minimum 1:${minRRR} - Trade valid` : `❌ RRR 1:${rrr.toFixed(2)} < minimum 1:${minRRR} - Trade rejected! TP extend කරන්න හෝ SL tight කරන්න.`
    };
}

function calculateADX(candles, period = 14) {
    if (candles.length < period * 2) return { adx: 20, status: "Weak" };
    let plusDM = 0, minusDM = 0, tr = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        let high = parseFloat(candles[i][2]), low = parseFloat(candles[i][3]);
        let prevHigh = parseFloat(candles[i-1][2]), prevLow = parseFloat(candles[i-1][3]), prevClose = parseFloat(candles[i-1][4]);
        let upMove = high - prevHigh, downMove = prevLow - low;
        if (upMove > downMove && upMove > 0) plusDM += upMove;
        if (downMove > upMove && downMove > 0) minusDM += downMove;
        tr += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    let plusDI = (plusDM / tr) * 100, minusDI = (minusDM / tr) * 100;
    let dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;
    let adx = isNaN(dx) ? 20 : dx;
    return {
        value: adx.toFixed(2), isStrong: adx >= 25,
        status: adx >= 25 ? `Strong Trend 🔥 (${adx.toFixed(1)})` : `Weak Trend ⚠️ (${adx.toFixed(1)})`
    };
}

module.exports = {
    calculateRSI, calculateEMA, calculateATR, checkDivergence, checkCandlePattern, 
    calculatePOC, calculateMACD, calculateVWAP, checkVolumeBreakout, validateEntryPoint,
    confirmEntry5m, checkRRR, calculateADX
};
