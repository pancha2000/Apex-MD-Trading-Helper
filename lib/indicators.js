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
    // ✅ FIXED: Wilder's Smoothed ATR (matches TradingView)
    // Simple average was 10-15% off. Wilder's smoothing is the standard.
    if (candles.length < period + 2) return 0;
    
    // Seed: first ATR = simple average of first 'period' TRs
    let trValues = [];
    for (let i = 1; i < candles.length; i++) {
        let high = parseFloat(candles[i][2]), low = parseFloat(candles[i][3]), prevClose = parseFloat(candles[i-1][4]);
        trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    if (trValues.length < period) return 0;
    
    // First ATR = simple mean of first 'period' TRs
    let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    // Wilder's smoothing for remaining TRs
    for (let i = period; i < trValues.length; i++) {
        atr = (atr * (period - 1) + trValues[i]) / period;
    }
    return isFinite(atr) ? atr.toFixed(4) : 0;
}

function checkDivergence(candles) {
    // ✅ FIXED: Swing pivot-based divergence (not fixed offset comparison)
    // Finds actual swing lows/highs and compares RSI at those exact points
    if (candles.length < 35) return "None";

    const closes = candles.map(c => parseFloat(c[4]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const n = closes.length;

    // Find last 2 swing lows (for bullish divergence)
    const swingLows = [];
    for (let i = 3; i < n - 2; i++) {
        if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
            swingLows.push(i);
        }
    }
    // Find last 2 swing highs (for bearish divergence)
    const swingHighs = [];
    for (let i = 3; i < n - 2; i++) {
        if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
            swingHighs.push(i);
        }
    }

    // Bullish Divergence: price lower low + RSI higher low
    if (swingLows.length >= 2) {
        const sl1 = swingLows[swingLows.length - 2];
        const sl2 = swingLows[swingLows.length - 1];
        if (sl2 - sl1 >= 5) { // at least 5 bars apart
            const rsi1 = calculateRSI(candles.slice(Math.max(0, sl1 - 14), sl1 + 1), 14);
            const rsi2 = calculateRSI(candles.slice(Math.max(0, sl2 - 14), sl2 + 1), 14);
            if (lows[sl2] < lows[sl1] && rsi2 > rsi1 && rsi2 < 50) {
                return "Bullish Divergence 🚀";
            }
        }
    }
    // Bearish Divergence: price higher high + RSI lower high
    if (swingHighs.length >= 2) {
        const sh1 = swingHighs[swingHighs.length - 2];
        const sh2 = swingHighs[swingHighs.length - 1];
        if (sh2 - sh1 >= 5) {
            const rsi1 = calculateRSI(candles.slice(Math.max(0, sh1 - 14), sh1 + 1), 14);
            const rsi2 = calculateRSI(candles.slice(Math.max(0, sh2 - 14), sh2 + 1), 14);
            if (highs[sh2] > highs[sh1] && rsi2 < rsi1 && rsi2 > 50) {
                return "Bearish Divergence ⚠️";
            }
        }
    }
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
    // Both EMAs on same full dataset (correct MACD calculation)
    const ema12Arr = calculateEMA(candles, 12, true);
    const ema26Arr = calculateEMA(candles, 26, true);
    if (!ema12Arr.length || !ema26Arr.length) return "Unknown";
    
    // MACD line = EMA12 - EMA26 (latest values)
    const macdLine = ema12Arr[ema12Arr.length - 1] - ema26Arr[ema26Arr.length - 1];
    const prevMacdLine = ema12Arr.length > 1 && ema26Arr.length > 1
        ? ema12Arr[ema12Arr.length - 2] - ema26Arr[ema26Arr.length - 2]
        : macdLine;
    
    // ✅ FIXED: Signal line = proper 9-period EMA of MACD line (not simple average)
    const macdHistory = ema12Arr.slice(-(ema26Arr.length)).map((v, i) => v - ema26Arr[i]);
    let signalLine = macdLine;
    if (macdHistory.length >= 9) {
        const sigK = 2 / (9 + 1);
        let sig = macdHistory.slice(0, 9).reduce((a, b) => a + b, 0) / 9; // seed
        for (let i = 9; i < macdHistory.length; i++) {
            sig = (macdHistory[i] - sig) * sigK + sig;
        }
        signalLine = sig;
    }
    
    const histogram = macdLine - signalLine;
    const isBullCross = macdLine > signalLine && prevMacdLine <= signalLine;
    const isBearCross = macdLine < signalLine && prevMacdLine >= signalLine;
    
    if (isBullCross) return `Bullish Cross 🟢 (${macdLine.toFixed(4)})`;
    if (isBearCross) return `Bearish Cross 🔴 (${macdLine.toFixed(4)})`;
    return macdLine > 0 ? `Bullish 🟢 (${macdLine.toFixed(4)})` : `Bearish 🔴 (${macdLine.toFixed(4)})`;
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
        if (entry < current * 0.97) return { valid: true, warning: `⏳ *ENTRY NOTE:* Entry ($${parseFloat(entry).toFixed(4)}) current price ($${parseFloat(current).toFixed(4)}) ට ${diff.toFixed(2)}% පහළයි. Limit Order set කරන්න.` };
    }
    if (direction === 'SHORT') {
        if (entry < current * 0.995) return { valid: false, warning: `⚠️ *ENTRY WARNING:* Signal Entry ($${entry}) current price ($${current}) ට ${diff.toFixed(2)}% පහළයි! Market Order ගන්න එපා.` };
        if (entry > current * 1.03) return { valid: true, warning: `⏳ *ENTRY NOTE:* Entry ($${parseFloat(entry).toFixed(4)}) current price ($${parseFloat(current).toFixed(4)}) ට ${diff.toFixed(2)}% ඉහළයි.` };
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
    // ✅ FIXED: Proper Wilder's smoothed ADX (matches TradingView)
    if (candles.length < period * 2 + 1) return { adx: 20, isStrong: false, status: "Weak Trend ⚠️ (20.0)", plusDI: 0, minusDI: 0 };

    let trArr = [], plusDMArr = [], minusDMArr = [];
    for (let i = 1; i < candles.length; i++) {
        const high = parseFloat(candles[i][2]), low = parseFloat(candles[i][3]);
        const prevHigh = parseFloat(candles[i-1][2]), prevLow = parseFloat(candles[i-1][3]), prevClose = parseFloat(candles[i-1][4]);
        const upMove = high - prevHigh, downMove = prevLow - low;
        trArr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        plusDMArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    if (trArr.length < period) return { adx: 20, isStrong: false, status: "Weak Trend ⚠️ (20.0)" };

    // Wilder's smoothed sums (seed = sum of first 'period' values)
    let smTR    = trArr.slice(0, period).reduce((a, b) => a + b, 0);
    let smPlus  = plusDMArr.slice(0, period).reduce((a, b) => a + b, 0);
    let smMinus = minusDMArr.slice(0, period).reduce((a, b) => a + b, 0);

    let dxArr = [];
    for (let i = period; i < trArr.length; i++) {
        smTR    = smTR - (smTR / period) + trArr[i];
        smPlus  = smPlus - (smPlus / period) + plusDMArr[i];
        smMinus = smMinus - (smMinus / period) + minusDMArr[i];
        const pDI = smTR > 0 ? (smPlus / smTR) * 100 : 0;
        const mDI = smTR > 0 ? (smMinus / smTR) * 100 : 0;
        const diSum = pDI + mDI;
        dxArr.push(diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0);
    }

    // ADX = smoothed DX (Wilder's)
    let adx = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dxArr.length; i++) {
        adx = (adx * (period - 1) + dxArr[i]) / period;
    }
    if (isNaN(adx) || !isFinite(adx)) adx = 20;

    // Final +DI / -DI for display
    const lastPDI = smTR > 0 ? (smPlus / smTR) * 100 : 0;
    const lastMDI = smTR > 0 ? (smMinus / smTR) * 100 : 0;

    return {
        value: parseFloat(adx.toFixed(2)),
        isStrong: adx >= 25,
        plusDI: parseFloat(lastPDI.toFixed(2)),
        minusDI: parseFloat(lastMDI.toFixed(2)),
        status: adx >= 40 ? `Strong Trend 🔥 (${adx.toFixed(1)})` :
                adx >= 25 ? `Trending 📈 (${adx.toFixed(1)})` :
                adx >= 15 ? `Weak Trend ⚠️ (${adx.toFixed(1)})` : `Choppy/Ranging 🔄 (${adx.toFixed(1)})`
    };
}

// ============================================================
// ✅ NEW FEATURE 1: Harmonic Pattern Scanner (Gartley & Bat)
// ============================================================
function checkHarmonicPattern(candles) {
    // ✅ FIXED: Proper 5-point harmonic structure (X, A, B, C, D)
    // Gartley: XA retracement B=0.618, D=0.786 of XA
    // Bat:     XA retracement B=0.382-0.5, D=0.886 of XA
    // Butterfly: B=0.786 of XA, D=1.272+ of XA (extension)
    if (candles.length < 40) return "None";

    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const n      = closes.length;
    const currentPrice = closes[n - 1];

    // Find swing pivots (local highs & lows)
    const swingHighIdx = [], swingLowIdx = [];
    for (let i = 2; i < n - 2; i++) {
        if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) swingHighIdx.push(i);
        if (lows[i]  < lows[i-1]  && lows[i]  < lows[i-2]  && lows[i]  < lows[i+1]  && lows[i]  < lows[i+2])  swingLowIdx.push(i);
    }
    if (swingHighIdx.length < 2 || swingLowIdx.length < 2) return "None";

    const tolerance = 0.03; // 3% tolerance on fib ratios

    function fibMatch(ratio, target, tol = tolerance) {
        return Math.abs(ratio - target) <= tol;
    }

    // Check Bullish patterns (price near recent swing low = D point)
    const recentLows = swingLowIdx.slice(-3);
    const recentHighs = swingHighIdx.slice(-3);

    for (let xi = 0; xi < recentHighs.length - 1; xi++) {
        for (let ai = 0; ai < recentLows.length; ai++) {
            const X = highs[recentHighs[xi]];
            const A = lows[recentLows[ai]];
            if (recentLows[ai] <= recentHighs[xi]) continue; // A must come after X
            const XA = X - A;
            if (XA <= 0) continue;

            // B retracement of XA
            for (let bi = 0; bi < recentHighs.length; bi++) {
                if (recentHighs[bi] <= recentLows[ai]) continue;
                const B = highs[recentHighs[bi]];
                const XB = (X - B) / XA;

                // Gartley B = 0.618
                if (fibMatch(XB, 0.618, 0.05)) {
                    // D should be at 0.786 of XA from X (below A)
                    const dGartley = X - XA * 0.786;
                    if (currentPrice >= dGartley * 0.985 && currentPrice <= dGartley * 1.015) {
                        return "Bullish Gartley 🦋 PRZ";
                    }
                }
                // Bat B = 0.382-0.50
                if (XB >= 0.35 && XB <= 0.55) {
                    const dBat = X - XA * 0.886;
                    if (currentPrice >= dBat * 0.985 && currentPrice <= dBat * 1.015) {
                        return "Bullish Bat 🦇 PRZ";
                    }
                }
                // Butterfly B = 0.786 → D extends beyond X (1.272-1.618 of XA)
                if (fibMatch(XB, 0.786, 0.05)) {
                    const dButterfly = X - XA * 1.272;
                    if (currentPrice >= dButterfly * 0.985 && currentPrice <= dButterfly * 1.015) {
                        return "Bullish Butterfly 🦋 PRZ";
                    }
                }
            }
        }
    }

    // Check Bearish patterns (price near recent swing high = D point)
    for (let xi = 0; xi < recentLows.length - 1; xi++) {
        for (let ai = 0; ai < recentHighs.length; ai++) {
            const X = lows[recentLows[xi]];
            const A = highs[recentHighs[ai]];
            if (recentHighs[ai] <= recentLows[xi]) continue;
            const XA = A - X;
            if (XA <= 0) continue;

            for (let bi = 0; bi < recentLows.length; bi++) {
                if (recentLows[bi] <= recentHighs[ai]) continue;
                const B = lows[recentLows[bi]];
                const XB = (B - X) / XA;

                if (fibMatch(XB, 0.618, 0.05)) {
                    const dGartley = X + XA * 0.786;
                    if (currentPrice >= dGartley * 0.985 && currentPrice <= dGartley * 1.015) {
                        return "Bearish Gartley 🦋 PRZ";
                    }
                }
                if (XB >= 0.35 && XB <= 0.55) {
                    const dBat = X + XA * 0.886;
                    if (currentPrice >= dBat * 0.985 && currentPrice <= dBat * 1.015) {
                        return "Bearish Bat 🦇 PRZ";
                    }
                }
                if (fibMatch(XB, 0.786, 0.05)) {
                    const dButterfly = X + XA * 1.272;
                    if (currentPrice >= dButterfly * 0.985 && currentPrice <= dButterfly * 1.015) {
                        return "Bearish Butterfly 🦋 PRZ";
                    }
                }
            }
        }
    }
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

    // ✅ FIX: Use RECENT swing (last 20 candles from entry) for realistic Fib targets
    // NOT historical 50-candle swing which gives unrealistic distant targets
    const recentCandles = candles.slice(-20);
    const highs = recentCandles.map(c => parseFloat(c[2]));
    const lows  = recentCandles.map(c => parseFloat(c[3]));
    const swingHigh = Math.max(...highs);
    const swingLow  = Math.min(...lows);
    const swingRange = swingHigh - swingLow;

    let tp1, tp2, tp3, tp1Label, tp2Label, tp3Label;

    // RRR-based TPs are always the primary — Fib only used if it gives BETTER (closer realistic) target
    if (direction === 'LONG') {
        const rrr2 = entry + (risk * 2.0);
        const rrr3 = entry + (risk * 3.0);
        const rrr5 = entry + (risk * 5.0);

        // ✅ FIX: Fib extension from recent swing low — only use if within 25% of entry (realistic)
        const fib1618 = swingLow + (swingRange * 1.618);
        const fib2618 = swingLow + (swingRange * 2.618);
        const useFib1618 = fib1618 > entry && fib1618 < entry * 1.25;
        const useFib2618 = fib2618 > entry && fib2618 < entry * 1.50;

        const whaleWall = whaleSellWall ? parseFloat(whaleSellWall) : null;
        const whaleTP = whaleWall && whaleWall > entry && whaleWall < entry * 1.15 ? whaleWall * 0.998 : null;

        // TP1: smallest of RRR2, fib1.618 (if valid), whale wall (if close)
        const tp1All = [rrr2, useFib1618 ? fib1618 : null, whaleTP].filter(p => p && p > entry);
        tp1 = tp1All.length > 0 ? Math.min(...tp1All) : rrr2;
        tp1Label = tp1 === rrr2 ? "1:2 RRR" : whaleTP && Math.abs(tp1 - whaleTP) < 0.0001 ? "Whale Wall" : "Fib 1.618";

        // TP2: smallest of RRR3, fib2.618 (if valid) — must be above tp1
        const tp2All = [rrr3, useFib2618 ? fib2618 : null].filter(p => p && p > tp1);
        tp2 = tp2All.length > 0 ? Math.min(...tp2All) : rrr3;
        tp2Label = tp2 === rrr3 ? "1:3 RRR" : "Fib 2.618";

        tp3 = rrr5;
        tp3Label = "1:5 RRR 🚀";

    } else {
        const rrr2 = entry - (risk * 2.0);
        const rrr3 = entry - (risk * 3.0);
        const rrr5 = entry - (risk * 5.0);

        // ✅ FIX: SHORT fib must stay POSITIVE and within 25% below entry
        const fib1618 = swingHigh - (swingRange * 1.618);
        const fib2618 = swingHigh - (swingRange * 2.618);
        const useFib1618 = fib1618 < entry && fib1618 > entry * 0.75 && fib1618 > 0;
        const useFib2618 = fib2618 < entry && fib2618 > entry * 0.50 && fib2618 > 0;

        const whaleWall = whaleBuyWall ? parseFloat(whaleBuyWall) : null;
        const whaleTP = whaleWall && whaleWall < entry && whaleWall > entry * 0.85 ? whaleWall * 1.002 : null;

        // TP1: largest of RRR2, fib1.618 (if valid) — must be below entry
        const tp1All = [rrr2, useFib1618 ? fib1618 : null, whaleTP].filter(p => p && p < entry);
        tp1 = tp1All.length > 0 ? Math.max(...tp1All) : rrr2;
        tp1Label = tp1 === rrr2 ? "1:2 RRR" : whaleTP && Math.abs(tp1 - whaleTP) < 0.0001 ? "Whale Wall" : "Fib 1.618";

        // TP2: largest of RRR3, fib2.618 — must be below tp1
        const tp2All = [rrr3, useFib2618 ? fib2618 : null].filter(p => p && p < tp1);
        tp2 = tp2All.length > 0 ? Math.max(...tp2All) : rrr3;
        tp2Label = tp2 === rrr3 ? "1:3 RRR" : "Fib 2.618";

        tp3 = rrr5;
        tp3Label = "1:5 RRR 🎯";
    }

    // ✅ SAFETY NET: if any TP is NaN/Infinity/invalid, fall back to RRR
    if (!isFinite(tp1) || isNaN(tp1)) { tp1 = direction === 'LONG' ? entry + risk*2 : entry - risk*2; tp1Label = "1:2 RRR"; }
    if (!isFinite(tp2) || isNaN(tp2)) { tp2 = direction === 'LONG' ? entry + risk*3 : entry - risk*3; tp2Label = "1:3 RRR"; }
    if (!isFinite(tp3) || isNaN(tp3)) { tp3 = direction === 'LONG' ? entry + risk*5 : entry - risk*5; tp3Label = "1:5 RRR"; }

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
        
        // Choose: prefer swing/OB but not too far (max 4x ATR away)
        const candidates = [swingBasedSL, obBasedSL, atrBasedSL]
            .filter(s => s !== null && !isNaN(s) && s < entry && (entry - s) < atr * 4);
        
        // Fallback: if no valid candidates, always use ATR
        sl = candidates.length > 0 ? Math.max(...candidates) : atrBasedSL;
        if (isNaN(sl) || sl <= 0) sl = atrBasedSL; // final safety net
        const slDiff1 = Math.abs(sl - swingBasedSL); const slDiff2 = obBasedSL ? Math.abs(sl - obBasedSL) : Infinity;
        slLabel = slDiff1 < 0.000001 ? "Swing Low" : slDiff2 < 0.000001 ? "OB Bottom" : "ATR 1.5x"; // ✅ FIX: float comparison
    } else {
        const recentSwingHigh = Math.max(...highs);
        const swingBasedSL = recentSwingHigh * 1.003;
        const obBasedSL = ob ? parseFloat(ob.top) * 1.002 : null;
        const atrBasedSL = entry + (atr * 1.5);
        
        const candidates = [swingBasedSL, obBasedSL, atrBasedSL]
            .filter(s => s !== null && !isNaN(s) && s > entry && (s - entry) < atr * 4);
        
        // Fallback: if no valid candidates, always use ATR
        sl = candidates.length > 0 ? Math.min(...candidates) : atrBasedSL;
        if (isNaN(sl) || sl <= 0) sl = atrBasedSL; // final safety net
        const slDiff1s = Math.abs(sl - swingBasedSL); const slDiff2s = obBasedSL ? Math.abs(sl - obBasedSL) : Infinity;
        slLabel = slDiff1s < 0.000001 ? "Swing High" : slDiff2s < 0.000001 ? "OB Top" : "ATR 1.5x"; // ✅ FIX: float comparison
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


// ============================================================
// ✅ NEW: Key Support/Resistance Levels from swing pivots
// Much better than min/max of 50 candles
// ============================================================
function getKeyLevels(candles, numLevels = 3) {
    if (candles.length < 20) return { supports: [], resistances: [], nearest: null };

    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const current = parseFloat(candles[candles.length - 1][4]);

    const swingHighs = [], swingLows = [];
    for (let i = 2; i < candles.length - 2; i++) {
        // Pivot high: higher than 2 bars each side
        if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
            swingHighs.push(highs[i]);
        }
        // Pivot low
        if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
            swingLows.push(lows[i]);
        }
    }

    // Cluster nearby levels (within 0.5%)
    function cluster(levels) {
        if (!levels.length) return [];
        levels.sort((a, b) => a - b);
        const result = [levels[0]];
        for (let i = 1; i < levels.length; i++) {
            if (Math.abs(levels[i] - result[result.length-1]) / result[result.length-1] > 0.005) {
                result.push(levels[i]);
            } else {
                // Average the cluster
                result[result.length-1] = (result[result.length-1] + levels[i]) / 2;
            }
        }
        return result;
    }

    const supports    = cluster(swingLows).filter(l => l < current).slice(-numLevels).reverse();
    const resistances = cluster(swingHighs).filter(l => l > current).slice(0, numLevels);

    const nearestSupport    = supports[0] || null;
    const nearestResistance = resistances[0] || null;
    const suppDist = nearestSupport    ? ((current - nearestSupport) / current * 100).toFixed(2)    : null;
    const resDist  = nearestResistance ? ((nearestResistance - current) / current * 100).toFixed(2) : null;

    return {
        supports:    supports.map(s => parseFloat(s.toFixed(4))),
        resistances: resistances.map(r => parseFloat(r.toFixed(4))),
        nearestSupport:    nearestSupport    ? parseFloat(nearestSupport.toFixed(4))    : null,
        nearestResistance: nearestResistance ? parseFloat(nearestResistance.toFixed(4)) : null,
        suppDistPct: suppDist, resDist,
        display: `🟢 S: $${nearestSupport?.toFixed(4) || 'N/A'} (${suppDist}%) | 🔴 R: $${nearestResistance?.toFixed(4) || 'N/A'} (${resDist}%)`
    };
}

// ============================================================
// ✅ NEW: EMA Ribbon (9, 21, 55, 200) — multi-confluence entry
// Price above all EMAs in order = strong bull zone
// Price pulling back to EMA21 in bull trend = ideal entry
// ============================================================
function getEMARibbon(candles) {
    if (candles.length < 210) return null;
    const current = parseFloat(candles[candles.length - 1][4]);
    const ema9   = parseFloat(calculateEMA(candles, 9));
    const ema21  = parseFloat(calculateEMA(candles, 21));
    const ema55  = parseFloat(calculateEMA(candles, 55));
    const ema200 = parseFloat(calculateEMA(candles, 200));

    const bullOrder = current > ema9 && ema9 > ema21 && ema21 > ema55 && ema55 > ema200;
    const bearOrder = current < ema9 && ema9 < ema21 && ema21 < ema55 && ema55 < ema200;
    const pullback21Bull = !bullOrder && current > ema55 && Math.abs(current - ema21) / current < 0.008; // within 0.8% of EMA21
    const pullback21Bear = !bearOrder && current < ema55 && Math.abs(current - ema21) / current < 0.008;

    let signal, quality;
    if (bullOrder)       { signal = "STRONG_BULL"; quality = "🟢🟢 Full Bull Ribbon"; }
    else if (bearOrder)  { signal = "STRONG_BEAR"; quality = "🔴🔴 Full Bear Ribbon"; }
    else if (pullback21Bull) { signal = "BULL_PULLBACK"; quality = "🟡 Bull Pullback to EMA21 (buy zone)"; }
    else if (pullback21Bear) { signal = "BEAR_PULLBACK"; quality = "🟡 Bear Pullback to EMA21 (sell zone)"; }
    else if (current > ema200) { signal = "BULL_MIXED"; quality = "⚪ Above EMA200 (mixed)"; }
    else { signal = "BEAR_MIXED"; quality = "⚪ Below EMA200 (mixed)"; }

    return {
        ema9: ema9.toFixed(4), ema21: ema21.toFixed(4),
        ema55: ema55.toFixed(4), ema200: ema200.toFixed(4),
        signal, quality,
        isBull: signal.startsWith("STRONG_BULL") || signal === "BULL_PULLBACK",
        isBear: signal.startsWith("STRONG_BEAR") || signal === "BEAR_PULLBACK",
        display: quality
    };
}

// ============================================================
// ✅ NEW: FVG (Fair Value Gap) Scanner — for TP targets
// FVGs are unfilled price imbalances that price usually revisits
// Bullish FVG = gap up (candle 1 high < candle 3 low) = support zone
// Bearish FVG = gap down (candle 1 low > candle 3 high) = resistance zone
// ============================================================
function scanFairValueGaps(candles) {
    if (candles.length < 5) return { bullFVGs: [], bearFVGs: [], nearest: null };
    const current = parseFloat(candles[candles.length - 1][4]);
    const bullFVGs = [], bearFVGs = [];

    for (let i = 2; i < candles.length - 1; i++) {
        const c1H = parseFloat(candles[i-2][2]), c1L = parseFloat(candles[i-2][3]);
        const c3H = parseFloat(candles[i][2]),   c3L = parseFloat(candles[i][3]);

        // Bullish FVG: gap between C1 high and C3 low (price gapped up)
        if (c1H < c3L) {
            const gapSize = c3L - c1H;
            const midpoint = (c1H + c3L) / 2;
            if (gapSize / midpoint > 0.001) { // at least 0.1% gap
                bullFVGs.push({ top: c3L.toFixed(4), bottom: c1H.toFixed(4), mid: midpoint.toFixed(4), filled: current < c3L });
            }
        }
        // Bearish FVG: gap between C1 low and C3 high (price gapped down)
        if (c1L > c3H) {
            const gapSize = c1L - c3H;
            const midpoint = (c1L + c3H) / 2;
            if (gapSize / midpoint > 0.001) {
                bearFVGs.push({ top: c1L.toFixed(4), bottom: c3H.toFixed(4), mid: midpoint.toFixed(4), filled: current > c1L });
            }
        }
    }

    // Find nearest unfilled FVG (potential TP target)
    const unfilledBull = bullFVGs.filter(f => !f.filled && parseFloat(f.mid) > current);
    const unfilledBear = bearFVGs.filter(f => !f.filled && parseFloat(f.mid) < current);
    const nearest = unfilledBull.length > 0
        ? { ...unfilledBull[unfilledBull.length - 1], type: 'BULL', direction: 'above' }
        : unfilledBear.length > 0
            ? { ...unfilledBear[unfilledBear.length - 1], type: 'BEAR', direction: 'below' }
            : null;

    return { bullFVGs, bearFVGs, nearest };
}


// ============================================================
// ✅ NEW: Supertrend Indicator (ATR-based dynamic trend line)
// ============================================================
function calculateSupertrend(candles, period = 10, multiplier = 3.0) {
    if (candles.length < period + 5) return { signal: 'NEUTRAL', isBull: false, isBear: false, justFlipUp: false, justFlipDown: false, supertrendLevel: '0', display: '⚪ Supertrend N/A' };

    // Build TR array
    const trArr = [];
    for (let i = 1; i < candles.length; i++) {
        const h = parseFloat(candles[i][2]), l = parseFloat(candles[i][3]), pc = parseFloat(candles[i-1][4]);
        trArr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }

    // Wilder's smoothed ATR
    let atr = trArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const atrArr = [atr];
    for (let i = period; i < trArr.length; i++) {
        atr = (atr * (period - 1) + trArr[i]) / period;
        atrArr.push(atr);
    }

    // Calculate upper/lower bands
    let prevUp = 0, prevDown = 0, prevST = 0, prevDir = 1;
    const stArr = [], dirArr = [];

    for (let i = 0; i < atrArr.length; i++) {
        const ci = i + 1;
        if (ci >= candles.length) break;
        const hl2 = (parseFloat(candles[ci][2]) + parseFloat(candles[ci][3])) / 2;
        const rawUp   = hl2 + multiplier * atrArr[i];
        const rawDown = hl2 - multiplier * atrArr[i];

        const prevClose = ci > 1 ? parseFloat(candles[ci-1][4]) : hl2;
        const finalUp   = (rawUp < prevUp || prevClose < prevUp) ? rawUp : prevUp;
        const finalDown = (rawDown > prevDown || prevClose > prevDown) ? rawDown : prevDown;

        const close = parseFloat(candles[ci][4]);
        let dir;
        if (prevST === prevUp)     dir = close > finalUp   ? 1 : -1;
        else                        dir = close < finalDown ? -1 : 1;

        const st = dir === 1 ? finalDown : finalUp;
        stArr.push(st); dirArr.push(dir);
        prevUp = finalUp; prevDown = finalDown; prevST = st; prevDir = dir;
    }

    if (stArr.length < 2) return { signal: 'NEUTRAL', isBull: false, isBear: false, justFlipUp: false, justFlipDown: false, supertrendLevel: '0', display: '⚪ Supertrend N/A' };

    const lastDir  = dirArr[dirArr.length - 1];
    const prevDirV = dirArr[dirArr.length - 2];
    const lastST   = stArr[stArr.length - 1];

    const isBull       = lastDir === 1;
    const isBear       = lastDir === -1;
    const justFlipUp   = lastDir === 1  && prevDirV === -1;
    const justFlipDown = lastDir === -1 && prevDirV === 1;

    const signal = isBull ? 'BULL' : 'BEAR';
    let display;
    if (justFlipUp)        display = `🟢🟢 *SUPERTREND FLIP UP* ⚡ Strong Buy! ($${lastST.toFixed(4)})`;
    else if (justFlipDown) display = `🔴🔴 *SUPERTREND FLIP DOWN* ⚡ Strong Sell! ($${lastST.toFixed(4)})`;
    else if (isBull)       display = `🟢 Supertrend Bull (Support: $${lastST.toFixed(4)})`;
    else                   display = `🔴 Supertrend Bear (Resistance: $${lastST.toFixed(4)})`;

    return { signal, isBull, isBear, justFlipUp, justFlipDown, supertrendLevel: lastST.toFixed(4), display };
}

// ============================================================
// ✅ NEW: RVOL - Relative Volume
// ============================================================
function calculateRVOL(candles) {
    if (candles.length < 22) return { rvol: 1.0, signal: 'NORMAL', isTrustworthy: false, display: '⚪ RVOL N/A' };

    const vols = candles.map(c => parseFloat(c[5]));
    const avgVol20 = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const currentVol = vols[vols.length - 1];
    const rvol = avgVol20 > 0 ? currentVol / avgVol20 : 1.0;

    let signal, display;
    if (rvol >= 3.0)      { signal = 'EXTREME'; display = `🔥🔥 RVOL ${rvol.toFixed(1)}x (Extreme! Institutional move)`; }
    else if (rvol >= 2.0) { signal = 'HIGH';    display = `🔥 RVOL ${rvol.toFixed(1)}x (High — trust the move)`; }
    else if (rvol >= 1.3) { signal = 'ABOVE';   display = `🟢 RVOL ${rvol.toFixed(1)}x (Above average)`; }
    else if (rvol >= 0.7) { signal = 'NORMAL';  display = `⚪ RVOL ${rvol.toFixed(1)}x (Normal)`; }
    else                  { signal = 'LOW';     display = `⚠️ RVOL ${rvol.toFixed(1)}x (Low — wait for volume)`; }

    return { rvol: parseFloat(rvol.toFixed(2)), signal, isTrustworthy: rvol >= 1.3, display };
}

// ============================================================
// ✅ NEW: MTF MACD Confluence (15m + 1H aligned)
// ============================================================
function checkMTFMACD(candles15m, candles1H) {
    if (!candles15m || !candles1H || candles15m.length < 35 || candles1H.length < 35) {
        return { signal: 'NEUTRAL', isBull: false, isBear: false, display: '⚪ MTF MACD N/A' };
    }

    function getMACDDir(candles) {
        const k12 = 2/13, k26 = 2/27;
        const prices = candles.map(c => parseFloat(c[4]));
        let e12 = prices[0], e26 = prices[0];
        for (let i = 1; i < prices.length; i++) {
            e12 = prices[i] * k12 + e12 * (1 - k12);
            e26 = prices[i] * k26 + e26 * (1 - k26);
        }
        return (e12 - e26) > 0 ? 'BULL' : 'BEAR';
    }

    const dir15m = getMACDDir(candles15m);
    const dir1H  = getMACDDir(candles1H);

    if (dir15m === 'BULL' && dir1H === 'BULL')
        return { signal: 'STRONG_BULL', isBull: true, isBear: false, display: '🟢🟢 MTF MACD Both Bull (15m+1H aligned)' };
    if (dir15m === 'BEAR' && dir1H === 'BEAR')
        return { signal: 'STRONG_BEAR', isBull: false, isBear: true, display: '🔴🔴 MTF MACD Both Bear (15m+1H aligned)' };
    return { signal: 'NEUTRAL', isBull: false, isBear: false,
             display: `⚪ MTF MACD Mixed (15m:${dir15m} | 1H:${dir1H})` };
}

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
    checkCandleCloseConfirmation,
    // ✅ FIXED: These were missing from exports!
    getKeyLevels,
    getEMARibbon,
    scanFairValueGaps,
    // ✅ NEW v4 indicators
    calculateSupertrend,
    calculateRVOL,
    checkMTFMACD
};

