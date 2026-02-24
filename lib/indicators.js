// ============================================================
// ✅ FIXED indicators.js - Apex MD Trading Helper
// Fixes: RSI (Wilder Smoothing), EMA (SMA Seed), VWAP (Daily Reset)
// ============================================================

// ✅ FIX 1: RSI - Wilder's Smoothing Method
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

// ✅ FIX 2: EMA - SMA Seed ක්රමය
function calculateEMA(candles, period = 50) {
    if (candles.length < period) return null;
    const k = 2 / (period + 1);
    let ema = 0;
    for (let i = 0; i < period; i++) ema += parseFloat(candles[i][4]);
    ema = ema / period;
    for (let i = period; i < candles.length; i++) {
        ema = (parseFloat(candles[i][4]) * k) + (ema * (1 - k));
    }
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

// ✅ FIX 3: Divergence - නිවැරදි RSI slice
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
    let pocPrice = minPrice + (maxVolIndex * binSize) + (binSize / 2);
    return pocPrice.toFixed(2);
}

function calculateMACD(candles) {
    if (candles.length < 35) return "Unknown";
    let ema12 = calculateEMA(candles.slice(-26), 12);
    let ema26 = calculateEMA(candles, 26);
    if (!ema12 || !ema26) return "Unknown";
    let macdLine = parseFloat(ema12) - parseFloat(ema26);
    return macdLine > 0 ? `Bullish 🟢 (${macdLine.toFixed(2)})` : `Bearish 🔴 (${macdLine.toFixed(2)})`;
}

// ✅ FIX 4: VWAP - Daily Reset
function calculateVWAP(candles) {
    if (candles.length < 5) return "Unknown";
    const lastCandleTime = parseInt(candles[candles.length - 1][0]);
    const lastCandleDate = new Date(lastCandleTime);
    const dayStart = new Date(lastCandleDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    let dailyCandles = candles.filter(c => parseInt(c[0]) >= dayStartMs);
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

// ✅ NEW: Entry Validation Function
function validateEntryPoint(entryPrice, currentPrice, direction) {
    const entry = parseFloat(entryPrice);
    const current = parseFloat(currentPrice);
    const diff = Math.abs(entry - current) / current * 100;
    if (direction === 'LONG') {
        if (entry > current * 1.005) {
            return { valid: false, warning: `⚠️ *ENTRY WARNING:* Signal Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% ඉහළයි! Market Order ගන්න එපා. OB zone retest වෙනකල් Limit Order set කරන්න.` };
        }
        if (entry < current * 0.97) {
            return { valid: true, warning: `⏳ *ENTRY NOTE:* Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% පහළයි. Price pullback වෙනකල් Limit Order set කරන්න.` };
        }
    }
    if (direction === 'SHORT') {
        if (entry < current * 0.995) {
            return { valid: false, warning: `⚠️ *ENTRY WARNING:* Signal Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% පහළයි! Market Order ගන්න එපා. Limit Order use කරන්න.` };
        }
        if (entry > current * 1.03) {
            return { valid: true, warning: `⏳ *ENTRY NOTE:* Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% ඉහළයි. Price retest කළ පසු enter කරන්න.` };
        }
    }
    return { valid: true, warning: "" };
}

module.exports = {
    calculateRSI, calculateEMA, calculateATR, checkDivergence,
    checkCandlePattern, calculatePOC, calculateMACD, calculateVWAP,
    checkVolumeBreakout, validateEntryPoint
};

// ============================================================
// ✅ NEW Feature 1: MTF 5m Entry Confirmation
// 15m signal ආවාම 5m candle ද align වෙනවාද confirm
// ============================================================
function confirmEntry5m(candles5m, direction) {
    if (!candles5m || candles5m.length < 20) {
        return { confirmed: false, score: 0, reason: "5m data insufficient" };
    }

    const rsi5m     = calculateRSI(candles5m.slice(-20), 14);
    const ema21_5m  = parseFloat(calculateEMA(candles5m.slice(-25), 21));
    const pattern5m = checkCandlePattern(candles5m.slice(-5));
    const lastClose = parseFloat(candles5m[candles5m.length - 1][4]);
    const lastOpen  = parseFloat(candles5m[candles5m.length - 1][1]);
    const prevClose = parseFloat(candles5m[candles5m.length - 2][4]);

    let score = 0;
    let reasons = [];
    let warnings = [];

    if (direction === 'LONG') {
        // 5m EMA21 ට ඉහළ close
        if (lastClose > ema21_5m) { score++; reasons.push("5m above EMA21"); }
        else { warnings.push("5m below EMA21 ⚠️"); }

        // 5m RSI oversold zone ලෙ නෑ (too deep)
        if (rsi5m > 25 && rsi5m < 60) { score++; reasons.push(`5m RSI ok (${rsi5m})`); }
        else if (rsi5m <= 25) { warnings.push(`5m RSI extreme oversold (${rsi5m}) - bounce possible but risky`); }
        else { warnings.push(`5m RSI overbought (${rsi5m}) - wait for pullback`); }

        // 5m bullish candle
        if (lastClose > lastOpen) { score++; reasons.push("5m bullish candle"); }
        else { warnings.push("5m bearish candle - wait for close"); }

        // 5m pattern
        if (pattern5m.includes('🟢')) { score++; reasons.push(`5m ${pattern5m}`); }

        // 5m momentum (last candle > prev candle)
        if (lastClose > prevClose) { score++; reasons.push("5m momentum up"); }

    } else { // SHORT
        if (lastClose < ema21_5m) { score++; reasons.push("5m below EMA21"); }
        else { warnings.push("5m above EMA21 ⚠️"); }

        if (rsi5m > 40 && rsi5m < 75) { score++; reasons.push(`5m RSI ok (${rsi5m})`); }
        else if (rsi5m >= 75) { warnings.push(`5m RSI extreme overbought (${rsi5m})`); }
        else { warnings.push(`5m RSI oversold (${rsi5m}) - wait`); }

        if (lastClose < lastOpen) { score++; reasons.push("5m bearish candle"); }
        else { warnings.push("5m bullish candle - wait for close"); }

        if (pattern5m.includes('🔴')) { score++; reasons.push(`5m ${pattern5m}`); }

        if (lastClose < prevClose) { score++; reasons.push("5m momentum down"); }
    }

    const confirmed = score >= 3;
    const status = confirmed
        ? `✅ 5m ALIGNED (${score}/5) - Entry confirmed!\n   ✔️ ${reasons.join(' | ')}`
        : `⚠️ 5m NOT ALIGNED (${score}/5) - Wait for 5m confirmation\n   ❌ ${warnings.join(' | ')}`;

    return { confirmed, score, maxScore: 5, reasons, warnings, status };
}

// ============================================================
// ✅ NEW Feature 2: RRR Pre-Filter
// Trade ගන්නට කලින් RRR minimum check
// ============================================================
function checkRRR(entryPrice, tpPrice, slPrice, minRRR = 1.5) {
    const entry = parseFloat(entryPrice);
    const tp    = parseFloat(tpPrice);
    const sl    = parseFloat(slPrice);

    const reward = Math.abs(tp - entry);
    const risk   = Math.abs(entry - sl);

    if (risk === 0) return { pass: false, rrr: 0, reason: "SL = Entry! Risk is 0." };

    const rrr = reward / risk;
    const pass = rrr >= minRRR;

    return {
        pass,
        rrr: rrr.toFixed(2),
        reward: reward.toFixed(2),
        risk: risk.toFixed(2),
        reason: pass
            ? `✅ RRR 1:${rrr.toFixed(2)} ≥ minimum 1:${minRRR} - Trade valid`
            : `❌ RRR 1:${rrr.toFixed(2)} < minimum 1:${minRRR} - Trade rejected! TP extend කරන්න හෝ SL tight කරන්න.`
    };
}

// ✅ NEW: ADX (Average Directional Index) Calculation
function calculateADX(candles, period = 14) {
    if (candles.length < period * 2) return { adx: 20, status: "Weak" };
    
    let plusDM = 0, minusDM = 0, tr = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        let high = parseFloat(candles[i][2]), low = parseFloat(candles[i][3]);
        let prevHigh = parseFloat(candles[i-1][2]), prevLow = parseFloat(candles[i-1][3]), prevClose = parseFloat(candles[i-1][4]);
        
        let upMove = high - prevHigh;
        let downMove = prevLow - low;
        
        if (upMove > downMove && upMove > 0) plusDM += upMove;
        if (downMove > upMove && downMove > 0) minusDM += downMove;
        
        tr += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    
    let plusDI = (plusDM / tr) * 100;
    let minusDI = (minusDM / tr) * 100;
    let dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;
    
    // Simplified ADX approximation for speed
    let adx = isNaN(dx) ? 20 : dx;
    
    return {
        value: adx.toFixed(2),
        isStrong: adx >= 25,
        status: adx >= 25 ? `Strong Trend 🔥 (${adx.toFixed(1)})` : `Weak Trend ⚠️ (${adx.toFixed(1)})`
    };
}

// ⚠️ අමතක නොකර module.exports එක ඇතුළට calculateADX එකත් දාන්න:
// calculateADX, <-- මේක එකතු කරන්න


module.exports = {
    calculateRSI, calculateEMA, calculateATR, checkDivergence,
    checkCandlePattern, calculatePOC, calculateMACD, calculateVWAP,
    checkVolumeBreakout, validateEntryPoint,
    confirmEntry5m, checkRRR, calculateADX   // ✅ NEW exports
};