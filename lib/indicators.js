// ============================================================
// ✅ UPGRADED indicators.js - Apex MD Trading Helper
// Added: Harmonic Pattern Scanner & ICT Silver Bullet
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

// ============================================================
// ✅ NEW FEATURE 1: Harmonic Pattern Scanner (Gartley & Bat)
// ============================================================
function checkHarmonicPattern(candles) {
    if (candles.length < 20) return "None";
    
    let highs = candles.map(c => parseFloat(c[2]));
    let lows = candles.map(c => parseFloat(c[3]));
    let currentPrice = parseFloat(candles[candles.length - 1][4]);

    // ආසන්නතම Swing High සහ Low ලබා ගැනීම (X to A leg)
    let maxH = Math.max(...highs.slice(-20, -5));
    let minL = Math.min(...lows.slice(-20, -5));

    // Bullish PRZ (Potential Reversal Zone)
    let swingUp = maxH - minL;
    let fib886 = maxH - (swingUp * 0.886); // Bat Pattern D Point
    let fib786 = maxH - (swingUp * 0.786); // Gartley Pattern D Point

    if (currentPrice <= fib786 * 1.002 && currentPrice >= fib786 * 0.998) return "Bullish Gartley 🦇";
    if (currentPrice <= fib886 * 1.002 && currentPrice >= fib886 * 0.998) return "Bullish Bat 🦇";

    // ✅ BUG FIX 3: Bearish PRZ - maxH ඉදලා downward fibs (minL ගලෝ)
    let swingDown = maxH - minL;
    let b_fib886 = maxH - (swingDown * 0.886);
    let b_fib786 = maxH - (swingDown * 0.786);

    if (currentPrice >= b_fib786 * 0.998 && currentPrice <= b_fib786 * 1.002) return "Bearish Gartley 🦇";
    if (currentPrice >= b_fib886 * 0.998 && currentPrice <= b_fib886 * 1.002) return "Bearish Bat 🦇";

    return "None";
}

// ============================================================
// ✅ NEW FEATURE 2: ICT Silver Bullet Time & FVG Checker
// ============================================================
function checkICTSilverBullet(candles) {
    if (candles.length < 5) return "None";
    
    const utcHour = new Date().getUTCHours();
    // Silver Bullet Times: 10 AM-11 AM EST (14:00-15:00 UTC) & 2 PM-3 PM EST (18:00-19:00 UTC)
    const isSilverBulletTime = (utcHour === 14 || utcHour === 15 || utcHour === 18 || utcHour === 19);

    if (!isSilverBulletTime) return "None";

    // Silver Bullet වෙලාව ඇතුළේ FVG (Fair Value Gap) එකක් හැදිලා තියෙනවද බලනවා
    let fvg = "None";
    for (let i = candles.length - 4; i < candles.length - 1; i++) {
        let c1High = parseFloat(candles[i-2][2]), c3Low = parseFloat(candles[i][3]);
        let c1Low = parseFloat(candles[i-2][3]), c3High = parseFloat(candles[i][2]);
        if (c1High < c3Low) fvg = "Bullish FVG";
        if (c1Low > c3High) fvg = "Bearish FVG";
    }

    if (fvg === "Bullish FVG") return "Bullish Silver Bullet 🎯";
    if (fvg === "Bearish FVG") return "Bearish Silver Bullet 🎯";

    return "Active Time (No FVG)";
}


// ============================================================
// ✅ NEW: Stochastic RSI - RSI ට වඩා sensitive signal
// Returns: { k, d, signal } — overbought > 80, oversold < 20
// ============================================================
function calculateStochRSI(candles, rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3) {
    if (candles.length < rsiPeriod + stochPeriod + smoothK + 5) return { k: 50, d: 50, signal: "Neutral" };
    
    // Calculate RSI array
    const rsiArr = [];
    for (let i = rsiPeriod; i <= candles.length; i++) {
        rsiArr.push(calculateRSI(candles.slice(0, i), rsiPeriod));
    }
    
    if (rsiArr.length < stochPeriod) return { k: 50, d: 50, signal: "Neutral" };
    
    // Stochastic of RSI
    const rawK = [];
    for (let i = stochPeriod - 1; i < rsiArr.length; i++) {
        const slice = rsiArr.slice(i - stochPeriod + 1, i + 1);
        const highest = Math.max(...slice);
        const lowest = Math.min(...slice);
        const range = highest - lowest;
        rawK.push(range === 0 ? 50 : ((rsiArr[i] - lowest) / range) * 100);
    }
    
    // Smooth K
    const smoothedK = [];
    for (let i = smoothK - 1; i < rawK.length; i++) {
        smoothedK.push(rawK.slice(i - smoothK + 1, i + 1).reduce((a, b) => a + b, 0) / smoothK);
    }
    
    // Smooth D (of smoothedK)
    const smoothedD = [];
    for (let i = smoothD - 1; i < smoothedK.length; i++) {
        smoothedD.push(smoothedK.slice(i - smoothD + 1, i + 1).reduce((a, b) => a + b, 0) / smoothD);
    }
    
    const k = smoothedK.length > 0 ? smoothedK[smoothedK.length - 1] : 50;
    const d = smoothedD.length > 0 ? smoothedD[smoothedD.length - 1] : 50;
    const prevK = smoothedK.length > 1 ? smoothedK[smoothedK.length - 2] : k;
    const prevD = smoothedD.length > 1 ? smoothedD[smoothedD.length - 2] : d;
    
    // Signal logic
    let signal = "Neutral";
    if (k < 20 && d < 20) signal = "Oversold 🟢";
    if (k > 80 && d > 80) signal = "Overbought 🔴";
    if (k < 20 && prevK <= prevD && k > d) signal = "Bullish Cross 🚀"; // K crosses above D from oversold
    if (k > 80 && prevK >= prevD && k < d) signal = "Bearish Cross 💀"; // K crosses below D from overbought
    
    return { 
        k: parseFloat(k.toFixed(2)), 
        d: parseFloat(d.toFixed(2)), 
        signal,
        isBull: k < 20 || signal.includes("Bullish"),
        isBear: k > 80 || signal.includes("Bearish")
    };
}

// ============================================================
// ✅ NEW: Bollinger Bands - Volatility + Mean Reversion signals
// Entry near lower band = statistically favorable for LONG
// ============================================================
function calculateBollingerBands(candles, period = 20, stdDev = 2) {
    if (candles.length < period) return { upper: 0, middle: 0, lower: 0, signal: "Neutral", width: 0, percentB: 50 };
    
    const closes = candles.slice(-period).map(c => parseFloat(c[4]));
    const mean = closes.reduce((a, b) => a + b, 0) / period;
    const variance = closes.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    const upper = mean + stdDev * std;
    const lower = mean - stdDev * std;
    const currentPrice = parseFloat(candles[candles.length - 1][4]);
    
    // %B = (price - lower) / (upper - lower) → 0=at lower, 1=at upper, 0.5=at middle
    const width = upper - lower;
    const percentB = width > 0 ? ((currentPrice - lower) / width) * 100 : 50;
    const squeeze = (width / mean) < 0.02; // Bandwidth < 2% = squeeze (breakout incoming)
    
    let signal = "Neutral";
    if (percentB < 5) signal = "At Lower Band 🟢 (Oversold zone)";
    else if (percentB > 95) signal = "At Upper Band 🔴 (Overbought zone)";
    else if (percentB < 20) signal = "Near Lower Band 🟡";
    else if (percentB > 80) signal = "Near Upper Band 🟡";
    else if (squeeze) signal = "BB Squeeze ⚡ (Breakout expected!)";
    
    return {
        upper: upper.toFixed(4), middle: mean.toFixed(4), lower: lower.toFixed(4),
        percentB: percentB.toFixed(1), width: width.toFixed(4), squeeze,
        signal, currentPrice,
        isBull: percentB < 20, // Near lower band = bullish setup
        isBear: percentB > 80  // Near upper band = bearish setup
    };
}

// ============================================================
// ✅ NEW: Multi-timeframe OB Detector 
// 1H OB + 15m OB overlap = 2x stronger zone
// ============================================================
function detectMTFOrderBlocks(candles15m, candles1H) {
    // 15m OBs
    const ob15 = detectMTFOBs(candles15m);
    // 1H OBs  
    const ob1H = detectMTFOBs(candles1H);
    const currentPrice = parseFloat(candles15m[candles15m.length-1][4]);
    
    // Check overlap
    let confluenceZone = null;
    
    if (ob15.bullish && ob1H.bullish) {
        const b15 = { low: parseFloat(ob15.bullish.bottom), high: parseFloat(ob15.bullish.top) };
        const b1H = { low: parseFloat(ob1H.bullish.bottom), high: parseFloat(ob1H.bullish.top) };
        // Overlap check
        const overlapLow = Math.max(b15.low, b1H.low);
        const overlapHigh = Math.min(b15.high, b1H.high);
        if (overlapLow < overlapHigh) {
            confluenceZone = { 
                type: 'BULLISH', bottom: overlapLow.toFixed(4), top: overlapHigh.toFixed(4),
                display: `🔥 MTF OB Confluence: $${overlapLow.toFixed(4)} - $${overlapHigh.toFixed(4)}`,
                strength: 'DOUBLE'
            };
        }
    }
    
    if (ob15.bearish && ob1H.bearish) {
        const s15 = { low: parseFloat(ob15.bearish.bottom), high: parseFloat(ob15.bearish.top) };
        const s1H = { low: parseFloat(ob1H.bearish.bottom), high: parseFloat(ob1H.bearish.top) };
        const overlapLow = Math.max(s15.low, s1H.low);
        const overlapHigh = Math.min(s1H.high, s15.high);
        if (overlapLow < overlapHigh) {
            confluenceZone = {
                type: 'BEARISH', bottom: overlapLow.toFixed(4), top: overlapHigh.toFixed(4),
                display: `🔥 MTF OB Confluence: $${overlapLow.toFixed(4)} - $${overlapHigh.toFixed(4)}`,
                strength: 'DOUBLE'
            };
        }
    }
    
    return { ob15, ob1H, confluenceZone };
}

function detectMTFOBs(candles) {
    let bullish = null, bearish = null;
    for (let i = candles.length - 10; i < candles.length - 2; i++) {
        if (i < 0) continue;
        const isRed = parseFloat(candles[i][4]) < parseFloat(candles[i][1]);
        const isGrn = parseFloat(candles[i][4]) > parseFloat(candles[i][1]);
        if (isRed && i+2 < candles.length && parseFloat(candles[i+2][4]) > parseFloat(candles[i][1])) {
            bullish = { bottom: parseFloat(candles[i][3]).toFixed(4), top: parseFloat(candles[i][1]).toFixed(4) };
        }
        if (isGrn && i+2 < candles.length && parseFloat(candles[i+2][4]) < parseFloat(candles[i][1])) {
            bearish = { bottom: parseFloat(candles[i][1]).toFixed(4), top: parseFloat(candles[i][2]).toFixed(4) };
        }
    }
    return { bullish, bearish };
}

// ============================================================
// ✅ NEW: Smart TP Calculator using Fib Extensions + HTF S/R
// Returns: tp1 (conservative), tp2 (normal), tp3 (extension)
// ============================================================
function calculateSmartTPs(entryPrice, sl, direction, candles, whaleSellWall = null, whaleBuyWall = null) {
    const entry = parseFloat(entryPrice);
    const slPrice = parseFloat(sl);
    const risk = Math.abs(entry - slPrice);
    
    // Swing range for Fib extension base
    const highs = candles.slice(-50).map(c => parseFloat(c[2]));
    const lows = candles.slice(-50).map(c => parseFloat(c[3]));
    const swingHigh = Math.max(...highs);
    const swingLow = Math.min(...lows);
    const swingRange = swingHigh - swingLow;
    
    let tp1, tp2, tp3, tp1Label, tp2Label, tp3Label;
    
    if (direction === 'LONG') {
        // Fib Extensions from swing low
        const fib1618 = swingLow + (swingRange * 1.618);
        const fib2618 = swingLow + (swingRange * 2.618);
        
        // RRR-based fallbacks
        const rrr2 = entry + (risk * 2.0);   // 1:2 RRR
        const rrr3 = entry + (risk * 3.0);   // 1:3 RRR
        const rrr5 = entry + (risk * 5.0);   // 1:5 RRR
        
        // Whale wall consideration
        const whaleWall = whaleSellWall ? parseFloat(whaleSellWall) : null;
        
        // TP1 = nearest of: Fib 1.618, 1:2 RRR, whale sell wall (if close)
        let tp1Candidates = [rrr2, fib1618].filter(p => p > entry);
        if (whaleWall && whaleWall > entry && whaleWall < entry * 1.1) tp1Candidates.push(whaleWall * 0.998); // just below wall
        tp1 = Math.min(...tp1Candidates);
        tp1Label = tp1 === rrr2 ? "1:2 RRR" : tp1 < (whaleWall || 0) * 1.001 ? "Whale Wall" : "Fib 1.618";
        
        // TP2 = nearest of: Fib 2.618, 1:3 RRR
        let tp2Candidates = [rrr3, fib2618].filter(p => p > tp1);
        tp2 = Math.min(...tp2Candidates);
        tp2Label = tp2 === rrr3 ? "1:3 RRR" : "Fib 2.618";
        
        // TP3 = 1:5 RRR (moon target)
        tp3 = rrr5;
        tp3Label = "1:5 RRR 🚀";
    } else {
        const fib1618 = swingHigh - (swingRange * 1.618);
        const fib2618 = swingHigh - (swingRange * 2.618);
        
        const rrr2 = entry - (risk * 2.0);
        const rrr3 = entry - (risk * 3.0);
        const rrr5 = entry - (risk * 5.0);
        
        const whaleWall = whaleBuyWall ? parseFloat(whaleBuyWall) : null;
        
        let tp1Candidates = [rrr2, fib1618].filter(p => p < entry);
        if (whaleWall && whaleWall < entry && whaleWall > entry * 0.9) tp1Candidates.push(whaleWall * 1.002);
        tp1 = Math.max(...tp1Candidates);
        tp1Label = tp1 === rrr2 ? "1:2 RRR" : "Fib 1.618";
        
        let tp2Candidates = [rrr3, fib2618].filter(p => p < tp1);
        tp2 = Math.max(...tp2Candidates);
        tp2Label = tp2 === rrr3 ? "1:3 RRR" : "Fib 2.618";
        
        tp3 = rrr5;
        tp3Label = "1:5 RRR 🎯";
    }
    
    return {
        tp1: parseFloat(tp1).toFixed(4), tp1Label,
        tp2: parseFloat(tp2).toFixed(4), tp2Label,
        tp3: parseFloat(tp3).toFixed(4), tp3Label
    };
}

// ============================================================
// ✅ NEW: Smart SL Calculator using Swing + ATR + OB
// Tighter and smarter than pure ATR-based SL
// ============================================================
function calculateSmartSL(entryPrice, direction, candles, ob = null, atrVal = null) {
    const entry = parseFloat(entryPrice);
    const atr = atrVal ? parseFloat(atrVal) : 
        parseFloat(calculateATR(candles.slice(-20), 14));
    
    const highs = candles.slice(-15).map(c => parseFloat(c[2]));
    const lows = candles.slice(-15).map(c => parseFloat(c[3]));
    
    let sl, slLabel;
    
    if (direction === 'LONG') {
        // Option 1: Recent swing low - 0.3% buffer
        const recentSwingLow = Math.min(...lows);
        const swingBasedSL = recentSwingLow * 0.997; // 0.3% below wick
        
        // Option 2: OB bottom - 0.2% buffer
        const obBasedSL = ob ? parseFloat(ob.bottom) * 0.998 : null;
        
        // Option 3: ATR-based (1.5x ATR below entry)
        const atrBasedSL = entry - (atr * 1.5);
        
        // Choose: prefer swing/OB but not too far (max 3x ATR away)
        const candidates = [swingBasedSL, obBasedSL, atrBasedSL]
            .filter(s => s !== null && s < entry && (entry - s) < atr * 4);
        
        sl = Math.max(...candidates); // tightest valid SL
        slLabel = sl === swingBasedSL ? "Swing Low" : sl === obBasedSL ? "OB Bottom" : "ATR 1.5x";
    } else {
        const recentSwingHigh = Math.max(...highs);
        const swingBasedSL = recentSwingHigh * 1.003;
        const obBasedSL = ob ? parseFloat(ob.top) * 1.002 : null;
        const atrBasedSL = entry + (atr * 1.5);
        
        const candidates = [swingBasedSL, obBasedSL, atrBasedSL]
            .filter(s => s !== null && s > entry && (s - entry) < atr * 4);
        
        sl = Math.min(...candidates);
        slLabel = sl === swingBasedSL ? "Swing High" : sl === obBasedSL ? "OB Top" : "ATR 1.5x";
    }
    
    return { 
        sl: parseFloat(sl).toFixed(4), 
        slLabel,
        slDistance: Math.abs(entry - sl).toFixed(4),
        slPct: (Math.abs(entry - sl) / entry * 100).toFixed(2)
    };
}


// ============================================================
// ✅ NEW: Multi-Timeframe RSI Confluence
// RSI oversold on BOTH 15m + 1H = 2x stronger entry signal
// ============================================================
function checkMTFRSIConfluence(candles15m, candles1H) {
    const rsi15 = calculateRSI(candles15m.slice(-50), 14);
    const rsi1H = calculateRSI(candles1H.slice(-50), 14);
    
    const is15mOversold  = rsi15 < 35;
    const is15mOverbought= rsi15 > 65;
    const is1HOversold   = rsi1H < 40;
    const is1HOverbought = rsi1H > 60;
    
    if (is15mOversold && is1HOversold) {
        return { signal: 'STRONG_BULL', isBull: true, isBear: false, 
                 display: `🟢🟢 MTF RSI Oversold (15m:${rsi15.toFixed(0)} + 1H:${rsi1H.toFixed(0)})` };
    }
    if (is15mOverbought && is1HOverbought) {
        return { signal: 'STRONG_BEAR', isBull: false, isBear: true,
                 display: `🔴🔴 MTF RSI Overbought (15m:${rsi15.toFixed(0)} + 1H:${rsi1H.toFixed(0)})` };
    }
    if (is15mOversold) {
        return { signal: 'MILD_BULL', isBull: true, isBear: false,
                 display: `🟡 RSI Oversold 15m (${rsi15.toFixed(0)})` };
    }
    if (is15mOverbought) {
        return { signal: 'MILD_BEAR', isBull: false, isBear: true,
                 display: `🟡 RSI Overbought 15m (${rsi15.toFixed(0)})` };
    }
    return { signal: 'NEUTRAL', isBull: false, isBear: false,
             display: `⚪ RSI Neutral (15m:${rsi15.toFixed(0)} / 1H:${rsi1H.toFixed(0)})` };
}

// ============================================================
// ✅ NEW: Volume Profile Node (High Volume Node = magnetic price)
// Entries AT a high-volume node = better fills, less slippage
// ============================================================
function detectVolumeNodes(candles, numBuckets = 20) {
    if (candles.length < 20) return { nearHVN: false, hvnPrice: null, lvnZone: null };

    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const vols   = candles.map(c => parseFloat(c[5]));
    const minP   = Math.min(...lows);
    const maxP   = Math.max(...highs);
    const bucket = (maxP - minP) / numBuckets;
    if (bucket === 0) return { nearHVN: false, hvnPrice: null };

    // Build volume profile buckets
    const profile = Array(numBuckets).fill(0);
    candles.forEach((c, i) => {
        const midP = (parseFloat(c[2]) + parseFloat(c[3])) / 2;
        const idx  = Math.min(Math.floor((midP - minP) / bucket), numBuckets - 1);
        profile[idx] += vols[i];
    });

    const maxVol = Math.max(...profile);
    const currentPrice = parseFloat(candles[candles.length-1][4]);

    // Find HVN (highest volume bucket) and LVN (lowest volume - fast moves)
    let hvnIdx = profile.indexOf(maxVol);
    const hvnPrice = minP + (hvnIdx + 0.5) * bucket;

    // Check if current price is near HVN (within 0.5%)
    const nearHVN = Math.abs(currentPrice - hvnPrice) / currentPrice < 0.005;

    // Find LVN zones (gaps in volume = fast price movement expected)
    const avgVol = profile.reduce((a,b)=>a+b,0) / numBuckets;
    const lvnZones = profile
        .map((v, i) => ({ vol: v, price: minP + (i+0.5)*bucket }))
        .filter(b => b.vol < avgVol * 0.3 && Math.abs(b.price - currentPrice)/currentPrice < 0.03);

    return {
        nearHVN,
        hvnPrice: hvnPrice.toFixed(4),
        hvnVol: maxVol.toFixed(0),
        lvnZones: lvnZones.slice(0, 2).map(z => z.price.toFixed(4)),
        display: nearHVN
            ? `🔥 HVN Zone: $${hvnPrice.toFixed(4)} (High liquidity - good entry!)`
            : lvnZones.length > 0
                ? `⚡ In LVN Zone → Fast move expected`
                : `⚪ Normal volume distribution`
    };
}

// ============================================================
// ✅ NEW: Session Filter (Trading Session Detector)
// London+NY overlap = highest volume = best for futures entries
// Asian session = low volume = fakeout risk
// ============================================================
function getSessionQuality() {
    const now = new Date();
    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const utcTime = utcH + utcM / 60;

    // Session times (UTC)
    // Asian:   00:00 - 09:00
    // London:  08:00 - 17:00
    // NY:      13:00 - 22:00
    // Overlap: 13:00 - 17:00 (London+NY - BEST)
    // Pre-NY:  08:00 - 13:00 (London only - good)

    const inAsian  = utcTime >= 0   && utcTime < 8;
    const inLondon = utcTime >= 8   && utcTime < 17;
    const inNY     = utcTime >= 13  && utcTime < 22;
    const inOverlap= utcTime >= 13  && utcTime < 17;

    let session, quality, emoji, advice;

    if (inOverlap) {
        session = 'London + NY Overlap';
        quality = 'BEST'; emoji = '🔥';
        advice  = 'Highest volume session - Best for entries!';
    } else if (inNY && !inOverlap) {
        session = 'New York';
        quality = 'GOOD'; emoji = '🟢';
        advice  = 'Good liquidity - OK for entries';
    } else if (inLondon && !inOverlap) {
        session = 'London';
        quality = 'GOOD'; emoji = '🟢';
        advice  = 'Good liquidity - OK for entries';
    } else if (inAsian) {
        session = 'Asian';
        quality = 'CAUTION'; emoji = '⚠️';
        advice  = 'Low volume - Fakeout risk high, wait for London';
    } else {
        // 22:00 - 00:00 UTC
        session = 'Off-Hours';
        quality = 'AVOID'; emoji = '🔴';
        advice  = 'Very low volume - avoid new entries';
    }

    return {
        session, quality, emoji, advice,
        utcTime: `${String(utcH).padStart(2,'0')}:${String(utcM).padStart(2,'0')} UTC`,
        isBestSession: quality === 'BEST' || quality === 'GOOD',
        display: `${emoji} ${session} Session (${String(utcH).padStart(2,'0')}:${String(utcM).padStart(2,'0')} UTC) — ${advice}`
    };
}

// ============================================================
// ✅ NEW: Candle Close Confirmation
// Entry only AFTER candle closes above/below key level
// Reduces false breakout entries significantly
// ============================================================
function checkCandleCloseConfirmation(candles, direction, keyLevel) {
    if (!candles || candles.length < 3) return { confirmed: false, display: 'Insufficient data' };

    const lastClosed = candles[candles.length - 2]; // last CLOSED candle (not current)
    const closePrice = parseFloat(lastClosed[4]);
    const openPrice  = parseFloat(lastClosed[1]);
    const high       = parseFloat(lastClosed[2]);
    const low        = parseFloat(lastClosed[3]);
    const isBullish  = closePrice > openPrice;
    const bodySize   = Math.abs(closePrice - openPrice);
    const totalRange = high - low;
    const bodyRatio  = totalRange > 0 ? bodySize / totalRange : 0;

    // Strong close = body > 60% of total range (not a doji/spinning top)
    const isStrongClose = bodyRatio > 0.6;

    let confirmed = false;
    let display = '';

    if (direction === 'LONG') {
        const closedAboveLevel = keyLevel ? closePrice > parseFloat(keyLevel) : isBullish;
        confirmed = closedAboveLevel && isBullish && isStrongClose;
        display = confirmed
            ? `✅ Strong Bull Candle Close (Body: ${(bodyRatio*100).toFixed(0)}%)`
            : `⏳ Waiting for bullish candle close above $${keyLevel || 'zone'}`;
    } else {
        const closedBelowLevel = keyLevel ? closePrice < parseFloat(keyLevel) : !isBullish;
        confirmed = closedBelowLevel && !isBullish && isStrongClose;
        display = confirmed
            ? `✅ Strong Bear Candle Close (Body: ${(bodyRatio*100).toFixed(0)}%)`
            : `⏳ Waiting for bearish candle close below $${keyLevel || 'zone'}`;
    }

    return { confirmed, isStrongClose, bodyRatio: (bodyRatio*100).toFixed(0), closePrice, display };
}

    // ... ඉහළ ඇති සියලුම functions වලට පසුව අවසානයට මෙය එක් කරන්න ...

module.exports = {
    calculateRSI, 
    calculateEMA, 
    calculateATR, 
    checkDivergence, 
    checkCandlePattern, 
    calculatePOC, 
    calculateMACD, 
    calculateVWAP, 
    checkVolumeBreakout, 
    validateEntryPoint,
    confirmEntry5m, 
    checkRRR, 
    calculateADX, 
    checkHarmonicPattern, 
    checkICTSilverBullet,
    calculateStochRSI, 
    calculateBollingerBands,
    detectMTFOrderBlocks,
    detectMTFOBs, 
    calculateSmartTPs, 
    calculateSmartSL,
    checkMTFRSIConfluence, 
    detectVolumeNodes, 
    getSessionQuality, 
    checkCandleCloseConfirmation
};

