/**
 * ═══════════════════════════════════════════════════════════════
 *  APEX-MD  ·  analyzer.js  ·  Sniper Entry & MTF-OB Edition
 *  ─────────────────────────────────────────────────────────────
 *  • 5m timeframe now live-streamed (500 candles, WS cache)
 *  • Full 5m SMC layer: OB, FVG, ChoCH, Liquidity Sweep
 *  • MTF Trade Classification:
 *      📅 SWING TRADE  — 4H OB zone + 5m/15m ChoCH/OB confirmation
 *      🌅 INTRADAY     — 1H OB zone + 15m/5m ChoCH/OB confirmation
 *      ⚡ HIGH-PROB SCALP — 15m OB zone + strict 5m confirmation
 *  • 5m OB/ChoCH/Sweep feed into the 14-Factor scoring system
 *  • All existing indicators, risk management, and return shape preserved
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const binance    = require('./binance');
const indicators = require('./indicators');
const smc        = require('./smartmoney');

// v4 precision tools
const {
    calculateStochRSI, calculateBollingerBands,
    detectMTFOrderBlocks, detectMTFOBs, validateEntryPoint,
    calculateSmartTPs, calculateSmartSL,
    checkMTFRSIConfluence, detectVolumeNodes, getSessionQuality,
    checkCandleCloseConfirmation, getKeyLevels, getEMARibbon,
    scanFairValueGaps, calculateSupertrend, calculateRVOL, checkMTFMACD,
} = require('./indicators');

// v5 world-class indicators
const {
    detectWyckoffPhase, detectBreakerBlocks, detectEqualHighsLows,
    checkPremiumDiscount, calculateWilliamsR, calculateIchimoku,
    getHeikinAshiTrend, approximateCVD, calculatePivotPoints,
    getPivotSignal, checkFibConfluence,
} = require('./indicators');

// v6 big-profit indicators
const {
    detectBBSqueezeExplosion, detectVolatilityExpansion, detectMarketMakerTrap,
    getWeeklyMonthlyTargets, detectCMEGap, check3TFAlignment,
} = require('./indicators');

// v7 PRO VVIP indicators
const {
    calculateGannAngles, calculateRenko, getMoonCycle,
    getDynamicSR, detectBOS, scanAdvancedCandlePatterns,
    getFibonacciLevels, calculateMFI, calculateROC, calculateCCI,
    detectMomentumShift,
} = require('./indicators');

// ══════════════════════════════════════════════════════════════
//  MTF TRADE CLASSIFICATION ENGINE
//  Determines trade type from OB-zone confluence across 4H, 1H,
//  15m, and 5m — replacing the old static timeframe-based label.
// ══════════════════════════════════════════════════════════════

/**
 * Checks if the current price is sitting inside (or very near)
 * an Order Block zone, allowing a 0.3% tolerance buffer.
 *
 * @param {Object|null} ob          - OB object with .bottom and .top strings
 * @param {number}      price       - current market price
 * @param {number}      tolerance   - fraction tolerance (default 0.3%)
 * @returns {boolean}
 */
function isPriceAtOB(ob, price, tolerance = 0.003) {
    if (!ob) return false;
    const bottom = parseFloat(ob.bottom);
    const top    = parseFloat(ob.top);
    // Widen the zone slightly above/below so pullbacks to the zone edge qualify
    return price >= bottom * (1 - tolerance) && price <= top * (1 + tolerance);
}

/**
 * Core classification function.
 *
 * Priority waterfall (highest to lowest):
 *   1. 📅 SWING TRADE    — price at 4H OB + 5m or 15m confirmation
 *   2. 🌅 INTRADAY TRADE — price at 1H OB + 15m or 5m confirmation
 *   3. ⚡ HIGH-PROB SCALP — price at 15m OB + strict 5m-only confirmation
 *   4. 📊 STANDARD SETUP — score-based, no OB confluence met
 *
 * @param {object} params
 * @param {number}      params.currentPrice
 * @param {string}      params.direction      'LONG' or 'SHORT'
 * @param {object}      params.ob4H           detectMTFOBs result for 4H candles
 * @param {object}      params.ob1H           detectMTFOBs result for 1H candles
 * @param {object}      params.ob15m          detectMTFOBs result for 15m candles
 * @param {object}      params.ob5m           detectMTFOBs result for 5m candles
 * @param {string}      params.choch5m        smc.checkChoCH result on 5m
 * @param {string}      params.choch15m       smc.checkChoCH result on 15m
 * @param {string}      params.sweep5m        smc.checkLiquiditySweep result on 5m
 * @param {string}      params.sweep15m       smc.checkLiquiditySweep result on 15m
 * @returns {object}    { label, htfZone, confirmTF, holdTime, riskNote, emoji }
 */
function classifyTrade({
    currentPrice,
    direction,
    ob4H,
    ob1H,
    ob15m,
    ob5m,
    choch5m,
    choch15m,
    sweep5m,
    sweep15m,
}) {
    const isLong  = direction === 'LONG';

    // ── Select directional OB for each timeframe ──────────────────
    const dirOB4H  = isLong ? ob4H.bullish  : ob4H.bearish;
    const dirOB1H  = isLong ? ob1H.bullish  : ob1H.bearish;
    const dirOB15m = isLong ? ob15m.bullish : ob15m.bearish;
    const dirOB5m  = isLong ? ob5m.bullish  : ob5m.bearish;

    // ── HTF zone presence flags ───────────────────────────────────
    const at4HOB  = isPriceAtOB(dirOB4H,  currentPrice);
    const at1HOB  = isPriceAtOB(dirOB1H,  currentPrice);
    const at15mOB = isPriceAtOB(dirOB15m, currentPrice);

    // ── Lower-TF confirmation flags (5m) ─────────────────────────
    // A 5m confirmation is valid when ANY of the following is true:
    //   • 5m ChoCH aligns with trade direction (structure reversal)
    //   • 5m Liquidity Sweep aligns (institutional entry)
    //   • A 5m OB in the direction exists (microstructure support/resist)
    const choch5mAligned  = isLong ? choch5m.includes('Bullish')  : choch5m.includes('Bearish');
    const sweep5mAligned  = isLong ? sweep5m.includes('Bullish')  : sweep5m.includes('Bearish');
    const ob5mAligned     = !!dirOB5m;
    const confirmed5m     = choch5mAligned || sweep5mAligned || ob5mAligned;

    // ── Lower-TF confirmation flags (15m) ────────────────────────
    const choch15mAligned = isLong ? choch15m.includes('Bullish') : choch15m.includes('Bearish');
    const sweep15mAligned = isLong ? sweep15m.includes('Bullish') : sweep15m.includes('Bearish');
    const ob15mAligned    = !!dirOB15m;
    const confirmed15m    = choch15mAligned || sweep15mAligned || ob15mAligned;

    // ── Build human-readable confirmation detail string ───────────
    function buildConfirmStr(tf, chochAligned, sweepAligned, obAligned) {
        const parts = [];
        if (chochAligned) parts.push(`${tf} ChoCH ✅`);
        if (sweepAligned) parts.push(`${tf} Sweep ✅`);
        if (obAligned)    parts.push(`${tf} OB ✅`);
        return parts.length ? parts.join(' + ') : `${tf} Pending ⏳`;
    }

    // ════════════════════════════════════════════════════════════
    //  1. 📅 SWING TRADE — price at 4H OB + any LTF confirmation
    // ════════════════════════════════════════════════════════════
    if (at4HOB && (confirmed5m || confirmed15m)) {
        const confStr = confirmed5m
            ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned)
            : buildConfirmStr('15m', choch15mAligned, sweep15mAligned, ob15mAligned);
        return {
            label:    '📅 SWING TRADE (Sniper Entry)',
            htfZone:  `4H OB: $${dirOB4H.bottom} – $${dirOB4H.top}`,
            confirmTF: confStr,
            holdTime: '2–7 Days',
            riskNote: 'Hold for full TP3. Wide SL. Scale in on 5m dips.',
            emoji:    '📅',
        };
    }

    // ════════════════════════════════════════════════════════════
    //  2. 🌅 INTRADAY TRADE — price at 1H OB + 15m or 5m confirm
    // ════════════════════════════════════════════════════════════
    if (at1HOB && (confirmed15m || confirmed5m)) {
        const confStr = confirmed5m
            ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned)
            : buildConfirmStr('15m', choch15mAligned, sweep15mAligned, ob15mAligned);
        return {
            label:    '🌅 INTRADAY TRADE (Sniper)',
            htfZone:  `1H OB: $${dirOB1H.bottom} – $${dirOB1H.top}`,
            confirmTF: confStr,
            holdTime: '4–24 Hours',
            riskNote: 'Target TP1/TP2. Move SL to break-even at TP1.',
            emoji:    '🌅',
        };
    }

    // ════════════════════════════════════════════════════════════
    //  3. ⚡ HIGH-PROB SCALP — price at 15m OB + strict 5m confirm
    // ════════════════════════════════════════════════════════════
    if (at15mOB && confirmed5m) {
        const confStr = buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned);
        return {
            label:    '⚡ HIGH-PROB SCALP',
            htfZone:  `15m OB: $${dirOB15m.bottom} – $${dirOB15m.top}`,
            confirmTF: confStr,
            holdTime: '30–240 Minutes',
            riskNote: 'Tight SL. Target TP1 only. Exit quickly.',
            emoji:    '⚡',
        };
    }

    // ════════════════════════════════════════════════════════════
    //  4. 📊 STANDARD SETUP — no OB confluence zone met
    // ════════════════════════════════════════════════════════════
    return {
        label:    '📊 STANDARD SETUP',
        htfZone:  'No HTF OB Confluence',
        confirmTF: confirmed5m ? buildConfirmStr('5m', choch5mAligned, sweep5mAligned, ob5mAligned) : 'Score-Based Entry',
        holdTime: 'Flexible',
        riskNote: 'Follow 14-Factor score. Wait for cleaner structure.',
        emoji:    '📊',
    };
}

// ══════════════════════════════════════════════════════════════
//  14-FACTOR ULTIMATE MARKET ANALYZER ENGINE
//  (Shareable module for Future, Spot, and Scanner)
//
//  DATA SOURCE: All kline data served from the in-memory
//  WebSocket cache via binance.getKlineDataFromCache().
//  Falls back to a one-time REST call automatically on cache miss.
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  INDICATOR-BASED TRADE PARAMETER REFINEMENT ENGINE
//  Runs AFTER base entry/SL/TP is calculated.
//  Uses computed indicators to improve price level precision.
//
//  Entry refinements:
//    • Breaker Block  — stronger than OB, institutions re-enter here
//    • Fib Confluence — price at cluster of fib levels = high prob zone
//    • Kijun retest   — Ichimoku Kijun is a dynamic institutional S/R
//
//  SL refinements (picks tightest VALID SL):
//    • Supertrend line — dynamic trailing SL
//    • Ichimoku Kijun  — if between entry and existing SL = better SL
//    • Cloud edge       — major S/R zone used as SL anchor
//    • Wyckoff Spring/UTAD — widens SL slightly for spike room
//
//  TP refinements:
//    • Pivot R1/R2/R3 (LONG), S1/S2/S3 (SHORT) — daily pivot targets
//    • Equal Highs/Lows — liquidity pools = natural TP magnets
//    • Ichimoku Cloud edge — natural S/R ahead of price
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  APEX-MD FULL-SPECTRUM TRADE PARAMETER REFINEMENT ENGINE v3
//  Runs AFTER base entry/SL/TP is calculated.
//  Uses ALL computed indicators to maximise RRR and win rate.
//  Zero extra API calls — all data from analyzer computation.
//
//  ── ENTRY (12 methods) ──────────────────────────────────────
//  1.  Breaker Block            — failed OB flipped polarity
//  2.  Fib Confluence Zone      — cluster of 3+ fib levels
//  3.  Kijun-sen retest         — Ichimoku institutional S/R
//  4.  MTF OB Confluence Zone   — 1H+15m OB overlap = double strength
//  5.  OTE Zone pin             — exact 61.8% or 78.6% fib price
//  6.  FVG midpoint entry       — unfilled Fair Value Gap
//  7.  Dynamic S/R support      — fractal-based Keltner support
//  8.  BOS confirmation         — enters only after BOS in direction
//  9.  Advanced candle patterns — Three Soldiers / Stars / Tweezer
//  10. Gann angle alignment     — price above 1x1 = bull intact
//  11. MFI extreme              — oversold/overbought volume confirmation
//  12. Williams %R extreme      — -80 oversold / -20 overbought
//
//  ── SL (14 methods) ──────────────────────────────────────────
//  1.  Supertrend line          — dynamic S/R trail
//  2.  Kijun-sen                — strongest Ichimoku dynamic S/R
//  3.  Ichimoku Cloud edge      — cloud = major S/R
//  4.  Wyckoff Spring/UTAD      — widen for spike room
//  5.  LVN placement            — SL just past Low Volume Node
//  6.  EQL/EQH liquidity guard  — SL below/above liquidity pool
//  7.  ADX adaptive ATR regime  — tighter SL in low vol, wider in high
//  8.  Session-based width      — Asian = wider, London/NY = standard
//  9.  Dynamic S/R fractal      — fractal low/high as SL anchor
//  10. Breaker Block guard      — SL beyond breaker edge
//  11. Gann 1x1 as SL           — Gann structural support
//  12. BB outer band            — volatility-based SL boundary
//  13. MFI momentum confirm     — MFI divergence = widen SL slightly
//  14. RVOL regime              — extreme RVOL = extra SL buffer
//
//  ── TP (16 methods) ──────────────────────────────────────────
//  1.  Pivot R1/R2/R3 (S1/S2/S3) — daily institutional targets
//  2.  EQH/EQL liquidity pools   — just before sweep zone
//  3.  Ichimoku Cloud edge       — cloud ahead = natural target
//  4.  FVG fill target           — unfilled FVG above/below
//  5.  Breaker Block barrier     — unfilled breaker ahead
//  6.  Weekly/Monthly pivot      — big-picture TP3 target
//  7.  CME Gap fill              — gap fill = reliable magnet
//  8.  Dynamic Resistance        — fractal resistance as TP cap
//  9.  Fib 1.618 extension       — from getFibonacciLevels (precise)
//  10. Fib 2.618 extension       — for TP3
//  11. BB upper/lower band       — volatility TP zone
//  12. Gann extension target     — Gann 2x1 / 3x1 projections
//  13. HVN magnet                — High Volume Node = price gravitates
//  14. Kijun-sen as TP           — dynamic target if ahead of entry
//  15. OB/BB confluence TP       — MTF OB confluence zone above
//  16. Tenkan crossover TP       — Ichimoku Tenkan as near TP
// ══════════════════════════════════════════════════════════════
function refineTradeParameters({
    entry, sl, slLabel,
    tp1, tp1Label, tp2, tp2Label, tp3, tp3Label,
    direction, atrVal, currentPrice,
    // v1 indicators
    ichimoku, supertrend, wyckoff, pivots, equalHL, breakers, fibConf,
    // new: all remaining available indicators
    mtfOB, fvgData, volNodes, bbands, rvol, adxData, session,
    dynamicSR, fibLevels, mfi, williamsR, advCandles, gannAngles, bos,
    weeklyTgts, cmeGap, heikinAshi,
}) {
    const isLong = direction === 'LONG';
    let rEntry  = parseFloat(entry);
    let rSL     = parseFloat(sl),    rSLLabel  = slLabel  || 'ATR';
    let rTP1    = parseFloat(tp1),   rTP1Label = tp1Label || '1:2 RRR';
    let rTP2    = parseFloat(tp2),   rTP2Label = tp2Label || '1:3 RRR';
    let rTP3    = parseFloat(tp3),   rTP3Label = tp3Label || '1:5 RRR';
    const atr   = parseFloat(atrVal) || 0;
    const cp    = parseFloat(currentPrice);
    const refinements = [];

    // ─────────────────────────────────────────────────────────────
    // SECTION A: ENTRY REFINEMENT
    // Priority: highest-quality zone wins (last write wins, so put
    // highest priority LAST so it overwrites lower-priority ones)
    // ─────────────────────────────────────────────────────────────

    // A1. Williams %R extreme — confirming we are at oversold/overbought reversal
    if (williamsR) {
        const wrOk = isLong ? williamsR.isBull : williamsR.isBear;
        if (wrOk && Math.abs(rEntry - cp) / cp < 0.002) {
            // Nudge entry to exactly current price (perfect timing signal)
            rEntry = isLong ? cp * 1.0005 : cp * 0.9995;
            refinements.push(`Entry pinned: W%R ${isLong ? 'Oversold' : 'Overbought'} $${rEntry.toFixed(4)}`);
        }
    }

    // A2. MFI extreme (volume-weighted RSI) — strongest timing signal
    if (mfi) {
        if (isLong && mfi.isBull && mfi.value < 25 && Math.abs(rEntry - cp) / cp < 0.003) {
            rEntry = cp * 1.001;
            refinements.push(`Entry: MFI Oversold (${mfi.value.toFixed(0)}) — Smart money buying $${rEntry.toFixed(4)}`);
        }
        if (!isLong && mfi.isBear && mfi.value > 75 && Math.abs(rEntry - cp) / cp < 0.003) {
            rEntry = cp * 0.999;
            refinements.push(`Entry: MFI Overbought (${mfi.value.toFixed(0)}) — Smart money selling $${rEntry.toFixed(4)}`);
        }
    }

    // A3. Gann angle alignment — price above/below 1x1 Gann angle
    if (gannAngles) {
        const gangOk = isLong ? gannAngles.isBull : gannAngles.isBear;
        if (gangOk && Math.abs(rEntry - cp) / cp < 0.004) {
            rEntry = isLong ? cp * 1.001 : cp * 0.999;
            refinements.push(`Entry: Gann ${isLong ? 'Bull' : 'Bear'} alignment confirmed $${rEntry.toFixed(4)}`);
        }
    }

    // A4. Advanced Candle Pattern — Three Soldiers/Crows, Tweezer, Morning Star
    if (advCandles && advCandles.pattern !== 'None') {
        const bullPatterns = ['Three White Soldiers', 'Morning Star', 'Tweezer Bottom', 'Bullish Harami', 'Piercing Line'];
        const bearPatterns = ['Three Black Crows',   'Evening Star', 'Tweezer Top',    'Bearish Harami', 'Dark Cloud Cover'];
        const isBullPat = bullPatterns.some(p => advCandles.pattern?.includes(p));
        const isBearPat = bearPatterns.some(p => advCandles.pattern?.includes(p));
        if ((isLong && isBullPat) || (!isLong && isBearPat)) {
            rEntry = isLong ? cp * 1.001 : cp * 0.999;
            refinements.push(`Entry: ${advCandles.pattern} pattern $${rEntry.toFixed(4)}`);
        }
    }

    // A5. BOS (Break of Structure) confirmation entry
    if (bos) {
        if (isLong && bos.bullBOS && Math.abs(rEntry - cp) / cp < 0.005) {
            rEntry = cp * 1.001;
            refinements.push(`Entry: Bull BOS confirmed — momentum breakout $${rEntry.toFixed(4)}`);
        }
        if (!isLong && bos.bearBOS && Math.abs(rEntry - cp) / cp < 0.005) {
            rEntry = cp * 0.999;
            refinements.push(`Entry: Bear BOS confirmed — momentum breakdown $${rEntry.toFixed(4)}`);
        }
    }

    // A6. Dynamic S/R fractal support/resistance — high-precision structural level
    if (dynamicSR) {
        if (isLong && dynamicSR.nearSupport && dynamicSR.support) {
            const sup = parseFloat(dynamicSR.support);
            if (Math.abs(sup - cp) / cp < 0.004) {
                rEntry = sup * 1.001;
                refinements.push(`Entry: Dynamic S/R Support $${rEntry.toFixed(4)}`);
            }
        }
        if (!isLong && dynamicSR.nearResist && dynamicSR.resistance) {
            const res = parseFloat(dynamicSR.resistance);
            if (Math.abs(res - cp) / cp < 0.004) {
                rEntry = res * 0.999;
                refinements.push(`Entry: Dynamic S/R Resistance $${rEntry.toFixed(4)}`);
            }
        }
    }

    // A7. FVG midpoint entry — price at Fair Value Gap = institutional fill zone
    if (fvgData) {
        const fvgs = isLong ? (fvgData.bullFVGs || []) : (fvgData.bearFVGs || []);
        const nearest = fvgs.find(g => {
            const mid = parseFloat(g.mid);
            return Math.abs(mid - cp) / cp < 0.004 && !g.filled;
        });
        if (nearest) {
            rEntry = parseFloat(nearest.mid);
            refinements.push(`Entry: FVG midpoint $${rEntry.toFixed(4)} (unfilled gap)`);
        }
    }

    // A8. MTF OB Confluence Zone — 1H + 15m OB overlap (stronger than single OB)
    if (mtfOB?.confluenceZone) {
        const cz = mtfOB.confluenceZone;
        const czBottom = parseFloat(cz.bottom), czTop = parseFloat(cz.top);
        if (isLong && cz.type === 'BULLISH' && cp >= czBottom * 0.998 && cp <= czTop * 1.002) {
            rEntry = czBottom * 1.001; // enter near bottom of confluence zone = best RRR
            refinements.push(`Entry: MTF OB Confluence $${rEntry.toFixed(4)} (1H+15m overlap 🔥)`);
        }
        if (!isLong && cz.type === 'BEARISH' && cp >= czBottom * 0.998 && cp <= czTop * 1.002) {
            rEntry = czTop * 0.999;
            refinements.push(`Entry: MTF OB Confluence $${rEntry.toFixed(4)} (1H+15m overlap 🔥)`);
        }
    }

    // A9. OTE Zone pin — Optimal Trade Entry 61.8%/78.6% fib retracement
    if (fibLevels?.isAtOTE) {
        const ote618 = parseFloat(fibLevels.key618);
        const ote786 = parseFloat(fibLevels.key786);
        const distTo618 = Math.abs(cp - ote618) / cp;
        const distTo786 = Math.abs(cp - ote786) / cp;
        if (isLong) {
            if (distTo618 < 0.005) {
                rEntry = ote618 * 1.001;
                refinements.push(`Entry: OTE 61.8% Zone $${rEntry.toFixed(4)} (Institutional sweet spot)`);
            } else if (distTo786 < 0.005) {
                rEntry = ote786 * 1.001;
                refinements.push(`Entry: OTE 78.6% Zone $${rEntry.toFixed(4)} (Deep discount)`);
            }
        } else {
            if (distTo618 < 0.005) {
                rEntry = ote618 * 0.999;
                refinements.push(`Entry: OTE 61.8% SHORT $${rEntry.toFixed(4)}`);
            } else if (distTo786 < 0.005) {
                rEntry = ote786 * 0.999;
                refinements.push(`Entry: OTE 78.6% SHORT $${rEntry.toFixed(4)}`);
            }
        }
    }

    // A10. Fib Confluence Zone — cluster of 3+ fib levels
    if (fibConf?.hasConfluence && fibConf.zone) {
        const fibZone = parseFloat(fibConf.zone);
        if (Math.abs(fibZone - cp) / cp < 0.005) {
            rEntry = fibZone;
            refinements.push(`Entry: Fib Confluence Zone $${rEntry.toFixed(4)} (${fibConf.count} levels)`);
        }
    }

    // A11. Ichimoku Kijun-sen retest — institutional dynamic S/R
    if (ichimoku?.kijun) {
        const kijun = parseFloat(ichimoku.kijun);
        if (Math.abs(kijun - cp) / cp < 0.003) {
            rEntry = isLong ? kijun * 1.001 : kijun * 0.999;
            refinements.push(`Entry: Kijun-sen retest $${rEntry.toFixed(4)}`);
        }
    }

    // A12. Breaker Block — highest priority: failed OB flipped polarity (LAST = wins)
    if (isLong && breakers?.bullishBreaker) {
        const bbTop = parseFloat(breakers.bullishBreaker.top);
        if (atr > 0 && Math.abs(bbTop - cp) < atr * 1.2) {
            rEntry = bbTop * 1.001;
            refinements.push(`Entry: Bull Breaker Block $${rEntry.toFixed(4)} 🔥`);
        }
    }
    if (!isLong && breakers?.bearishBreaker) {
        const bbBot = parseFloat(breakers.bearishBreaker.bottom);
        if (atr > 0 && Math.abs(bbBot - cp) < atr * 1.2) {
            rEntry = bbBot * 0.999;
            refinements.push(`Entry: Bear Breaker Block $${rEntry.toFixed(4)} 🔥`);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // SECTION B: SL REFINEMENT
    // Goal: find tightest structurally VALID SL.
    // "Tighter" = closer to entry but still with structure behind it.
    // Only accept if new SL is BETWEEN entry and existing SL.
    // ─────────────────────────────────────────────────────────────

    const slTighten = (newSL, label) => {
        if (isLong  && newSL < rEntry && newSL > rSL)  { rSL = newSL; rSLLabel = label; refinements.push(`SL → ${label} $${rSL.toFixed(4)}`); }
        if (!isLong && newSL > rEntry && newSL < rSL)  { rSL = newSL; rSLLabel = label; refinements.push(`SL → ${label} $${rSL.toFixed(4)}`); }
    };
    const slWiden = (newSL, label) => {
        if (isLong  && newSL < rEntry) { rSL = newSL; rSLLabel = label; refinements.push(`SL widened → ${label} $${rSL.toFixed(4)}`); }
        if (!isLong && newSL > rEntry) { rSL = newSL; rSLLabel = label; refinements.push(`SL widened → ${label} $${rSL.toFixed(4)}`); }
    };

    // B1. Supertrend dynamic trail
    if (supertrend?.supertrendLevel && parseFloat(supertrend.supertrendLevel) > 0) {
        const stLevel = parseFloat(supertrend.supertrendLevel);
        if (isLong && supertrend.isBull) slTighten(stLevel * 0.998, 'Supertrend');
        if (!isLong && supertrend.isBear) slTighten(stLevel * 1.002, 'Supertrend');
    }

    // B2. Ichimoku Kijun-sen
    if (ichimoku?.kijun) {
        const kijun = parseFloat(ichimoku.kijun);
        slTighten(isLong ? kijun * 0.997 : kijun * 1.003, 'Kijun SL');
    }

    // B3. Ichimoku Cloud edge
    if (ichimoku && !ichimoku.inCloud) {
        if (isLong  && ichimoku.cloudTop) slTighten(parseFloat(ichimoku.cloudTop) * 0.997, 'Cloud SL');
        if (!isLong && ichimoku.cloudBot)  slTighten(parseFloat(ichimoku.cloudBot) * 1.003, 'Cloud SL');
    }

    // B4. Dynamic S/R fractal level
    if (dynamicSR) {
        if (isLong  && dynamicSR.support)    slTighten(parseFloat(dynamicSR.support) * 0.997,    'Fractal S/R SL');
        if (!isLong && dynamicSR.resistance) slTighten(parseFloat(dynamicSR.resistance) * 1.003, 'Fractal S/R SL');
    }

    // B5. Breaker Block edge — SL just beyond the block's far edge
    if (isLong && breakers?.bullishBreaker) {
        slTighten(parseFloat(breakers.bullishBreaker.bottom) * 0.997, 'Breaker SL');
    }
    if (!isLong && breakers?.bearishBreaker) {
        slTighten(parseFloat(breakers.bearishBreaker.top) * 1.003, 'Breaker SL');
    }

    // B6. LVN (Low Volume Node) — SL just beyond nearest LVN (price moves fast through LVN)
    if (volNodes?.lvnZones && volNodes.lvnZones.length > 0) {
        const lvns = volNodes.lvnZones.map(z => parseFloat(z)).filter(z => isFinite(z));
        if (isLong) {
            const lvnBelow = lvns.filter(z => z < rEntry).sort((a, b) => b - a)[0];
            if (lvnBelow) slTighten(lvnBelow * 0.997, 'LVN SL');
        } else {
            const lvnAbove = lvns.filter(z => z > rEntry).sort((a, b) => a - b)[0];
            if (lvnAbove) slTighten(lvnAbove * 1.003, 'LVN SL');
        }
    }

    // B7. EQL/EQH liquidity guard — SL just below/above liquidity pool
    //     (stop hunters target EQL/EQH first, so SL below/above those pools)
    if (equalHL) {
        if (isLong && equalHL.eql) {
            const eqlSL = parseFloat(equalHL.eql.level) * 0.995;
            slTighten(eqlSL, 'EQL Guard SL');
        }
        if (!isLong && equalHL.eqh) {
            const eqhSL = parseFloat(equalHL.eqh.level) * 1.005;
            slTighten(eqhSL, 'EQH Guard SL');
        }
    }

    // B8. Bollinger Band outer — SL at 2σ band (statistical extreme)
    if (bbands) {
        const bbSL = isLong ? parseFloat(bbands.lower) : parseFloat(bbands.upper);
        if (bbSL && isFinite(bbSL)) slTighten(isLong ? bbSL * 0.998 : bbSL * 1.002, 'BB Band SL');
    }

    // B9. Ichimoku Tenkan-sen (tighter than Kijun, short-term momentum line)
    if (ichimoku?.tenkan) {
        const tenkan = parseFloat(ichimoku.tenkan);
        // Only use as SL if price is significantly above/below it (confirmation)
        if (isLong && tenkan < rEntry * 0.995) slTighten(tenkan * 0.997, 'Tenkan SL');
        if (!isLong && tenkan > rEntry * 1.005) slTighten(tenkan * 1.003, 'Tenkan SL');
    }

    // ── Widening adjustments (AFTER tightening, so they always apply) ──

    // B10. ADX-based volatility regime
    if (adxData) {
        const adxVal = parseFloat(adxData.adx || adxData.value || 0);
        if (adxVal > 35 && rvol?.signal === 'EXTREME') {
            // High volatility regime — widen SL to avoid whipsaw
            slWiden(isLong ? rSL * 0.993 : rSL * 1.007, 'High Vol SL');
        } else if (adxVal < 18) {
            // Low volatility / choppy — slightly tighter is fine
            const tighter = isLong ? rSL * 1.004 : rSL * 0.996;
            slTighten(tighter, 'Low Vol SL');
        }
    }

    // B11. Session-based width
    if (session) {
        if (session.quality === 'CAUTION') {
            // Asian session = fakeout-prone = widen SL slightly
            slWiden(isLong ? rSL * 0.996 : rSL * 1.004, 'Asian Session SL');
        }
    }

    // B12. Wyckoff Spring / UTAD spike room
    if (wyckoff?.phase === 'SPRING' && isLong)  slWiden(rSL * 0.996, 'Spring SL');
    if (wyckoff?.phase === 'UTAD'   && !isLong) slWiden(rSL * 1.004, 'UTAD SL');

    // B13. MFI divergence — if MFI conflicts with trade = widen SL slightly
    if (mfi && ((isLong && mfi.isBear) || (!isLong && mfi.isBull))) {
        slWiden(isLong ? rSL * 0.996 : rSL * 1.004, 'MFI Conflict Buffer SL');
    }

    // B14. RVOL extreme — massive volume = potential volatility spike
    if (rvol?.signal === 'EXTREME') {
        slWiden(isLong ? rSL * 0.994 : rSL * 1.006, 'RVOL Extreme Buffer SL');
    }

    // ─────────────────────────────────────────────────────────────
    // SECTION C: TP REFINEMENT
    // Base risk recalculated after SL is finalised
    // ─────────────────────────────────────────────────────────────
    const risk = Math.abs(rEntry - rSL) || atr * 1.5;

    // Helper: snap TP to a level if it's closer to entry than current TP
    // and within tolerance — i.e., a "better" (more realistic) target
    const snapTP1 = (level, label, tol = 0.04) => {
        if (!level || !isFinite(level)) return;
        if (isLong  && level > rEntry && Math.abs(level - rTP1) / rTP1 < tol) { rTP1 = level; rTP1Label = label; refinements.push(`TP1 → ${label} $${rTP1.toFixed(4)}`); }
        if (!isLong && level < rEntry && Math.abs(level - rTP1) / rTP1 < tol) { rTP1 = level; rTP1Label = label; refinements.push(`TP1 → ${label} $${rTP1.toFixed(4)}`); }
    };
    const snapTP2 = (level, label, tol = 0.07) => {
        if (!level || !isFinite(level)) return;
        if (isLong  && level > rTP1  && Math.abs(level - rTP2) / rTP2 < tol) { rTP2 = level; rTP2Label = label; refinements.push(`TP2 → ${label} $${rTP2.toFixed(4)}`); }
        if (!isLong && level < rTP1  && Math.abs(level - rTP2) / rTP2 < tol) { rTP2 = level; rTP2Label = label; refinements.push(`TP2 → ${label} $${rTP2.toFixed(4)}`); }
    };
    const snapTP3 = (level, label) => {
        if (!level || !isFinite(level)) return;
        if (isLong  && level > rTP2 && level < rTP3) { rTP3 = level; rTP3Label = label; refinements.push(`TP3 → ${label} $${rTP3.toFixed(4)}`); }
        if (!isLong && level < rTP2 && level > rTP3) { rTP3 = level; rTP3Label = label; refinements.push(`TP3 → ${label} $${rTP3.toFixed(4)}`); }
    };

    // C1. Daily Pivot levels — institutional intraday TP magnets
    if (pivots) {
        if (isLong) {
            snapTP1(parseFloat(pivots.R1) * 0.999, 'Pivot R1');
            snapTP2(parseFloat(pivots.R2) * 0.999, 'Pivot R2');
            snapTP3(parseFloat(pivots.R3),          'Pivot R3 🎯');
        } else {
            snapTP1(parseFloat(pivots.S1) * 1.001, 'Pivot S1');
            snapTP2(parseFloat(pivots.S2) * 1.001, 'Pivot S2');
            snapTP3(parseFloat(pivots.S3),          'Pivot S3 🎯');
        }
    }

    // C2. Ichimoku Kijun-sen as TP (if ahead of entry = dynamic target)
    if (ichimoku?.kijun) {
        const kijun = parseFloat(ichimoku.kijun);
        snapTP1(isLong ? kijun * 0.999 : kijun * 1.001, 'Kijun TP');
    }

    // C3. Ichimoku Tenkan-sen as near TP (very close, early exit signal)
    if (ichimoku?.tenkan) {
        const tenkan = parseFloat(ichimoku.tenkan);
        if (isLong && tenkan > rEntry * 1.003) snapTP1(tenkan * 0.999, 'Tenkan TP1');
        if (!isLong && tenkan < rEntry * 0.997) snapTP1(tenkan * 1.001, 'Tenkan TP1');
    }

    // C4. Ichimoku Cloud edge — natural S/R zone ahead
    if (ichimoku && !ichimoku.inCloud) {
        if (isLong  && ichimoku.cloudBot)  snapTP1(parseFloat(ichimoku.cloudBot) * 0.999, 'Cloud Bot TP');
        if (!isLong && ichimoku.cloudTop)  snapTP1(parseFloat(ichimoku.cloudTop) * 1.001, 'Cloud Top TP');
    }

    // C5. FVG fill — unfilled FVG above/below entry = price always returns to fill
    if (fvgData) {
        const bullFVGs = (fvgData.bullFVGs || []).filter(g => !g.filled);
        const bearFVGs = (fvgData.bearFVGs || []).filter(g => !g.filled);
        if (isLong) {
            const above = bullFVGs.filter(g => parseFloat(g.mid) > rEntry).sort((a, b) => parseFloat(a.mid) - parseFloat(b.mid));
            if (above[0]) snapTP1(parseFloat(above[0].mid), 'FVG Fill TP1');
            if (above[1]) snapTP2(parseFloat(above[1].mid), 'FVG Fill TP2');
        } else {
            const below = bearFVGs.filter(g => parseFloat(g.mid) < rEntry).sort((a, b) => parseFloat(b.mid) - parseFloat(a.mid));
            if (below[0]) snapTP1(parseFloat(below[0].mid), 'FVG Fill TP1');
            if (below[1]) snapTP2(parseFloat(below[1].mid), 'FVG Fill TP2');
        }
    }

    // C6. EQH/EQL — just before liquidity pool (smart money targets these)
    if (equalHL) {
        if (isLong && equalHL.eqh) {
            const pool = parseFloat(equalHL.eqh.level) * 0.997;
            if (pool > rEntry) {
                if (pool < rTP1 * 1.03) { rTP1 = pool; rTP1Label = 'EQH Pool TP1'; refinements.push(`TP1 → EQH $${rTP1.toFixed(4)}`); }
                else snapTP2(pool, 'EQH Pool TP2');
            }
        }
        if (!isLong && equalHL.eql) {
            const pool = parseFloat(equalHL.eql.level) * 1.003;
            if (pool < rEntry) {
                if (pool > rTP1 * 0.97) { rTP1 = pool; rTP1Label = 'EQL Pool TP1'; refinements.push(`TP1 → EQL $${rTP1.toFixed(4)}`); }
                else snapTP2(pool, 'EQL Pool TP2');
            }
        }
    }

    // C7. Dynamic Resistance/Support — fractal level = structural TP cap
    if (dynamicSR) {
        if (isLong  && dynamicSR.resistance) snapTP1(parseFloat(dynamicSR.resistance) * 0.998, 'Dynamic Resist TP');
        if (!isLong && dynamicSR.support)    snapTP1(parseFloat(dynamicSR.support)    * 1.002, 'Dynamic Support TP');
    }

    // C8. HVN (High Volume Node) — price gravitates toward high volume zones
    if (volNodes?.hvnPrice && volNodes.hvnPrice !== '0.0000') {
        const hvn = parseFloat(volNodes.hvnPrice);
        if (isLong  && hvn > rEntry) snapTP1(hvn, 'HVN Magnet TP');
        if (!isLong && hvn < rEntry) snapTP1(hvn, 'HVN Magnet TP');
    }

    // C9. Bollinger Band outer as TP — price reaching 2σ = natural mean-reversion TP
    if (bbands) {
        if (isLong  && bbands.upper) snapTP1(parseFloat(bbands.upper) * 0.998, 'BB Upper TP');
        if (!isLong && bbands.lower) snapTP1(parseFloat(bbands.lower) * 1.002, 'BB Lower TP');
    }

    // C10. Precise Fib extensions from getFibonacciLevels (full level set)
    if (fibLevels?.levels) {
        if (isLong) {
            const ext1272 = parseFloat(fibLevels.ext1272);
            const ext1618 = parseFloat(fibLevels.ext1618);
            const ext2618 = parseFloat(fibLevels.ext2618);
            if (ext1272 > rEntry) snapTP1(ext1272, 'Fib 1.272 TP1');
            if (ext1618 > rTP1)   snapTP2(ext1618, 'Fib 1.618 TP2 🎯');
            if (ext2618 > rTP2)   snapTP3(ext2618, 'Fib 2.618 TP3 🚀');
        } else {
            // SHORT: retracement levels below are TP targets
            const ret382 = parseFloat(fibLevels.key382);
            const ret618 = parseFloat(fibLevels.key618);
            if (ret618 < rEntry) snapTP1(ret618, 'Fib 61.8% TP1');
            if (ret382 < rTP1)   snapTP2(ret382, 'Fib 38.2% TP2');
        }
    }

    // C11. Breaker block barrier ahead — price drawn toward unfilled breaker
    if (breakers) {
        if (isLong && breakers.bearishBreaker) {
            const bbBot = parseFloat(breakers.bearishBreaker.bottom);
            if (bbBot > rEntry) snapTP2(bbBot * 0.997, 'Breaker Barrier TP');
        }
        if (!isLong && breakers.bullishBreaker) {
            const bbTop = parseFloat(breakers.bullishBreaker.top);
            if (bbTop < rEntry) snapTP2(bbTop * 1.003, 'Breaker Barrier TP');
        }
    }

    // C12. MTF OB Confluence zone above/below — major institutional target
    if (mtfOB?.confluenceZone) {
        const czBottom = parseFloat(mtfOB.confluenceZone.bottom);
        const czTop    = parseFloat(mtfOB.confluenceZone.top);
        if (isLong  && czBottom > rEntry) snapTP2(czBottom, 'MTF OB Confluence TP 🔥');
        if (!isLong && czTop    < rEntry) snapTP2(czTop,    'MTF OB Confluence TP 🔥');
    }

    // C13. CME Gap fill — highly reliable magnet, usually fills within days
    if (cmeGap?.hasGap && cmeGap.gapMid) {
        const gapMid = parseFloat(cmeGap.gapMid);
        if (isLong  && gapMid > rEntry) snapTP3(gapMid, 'CME Gap Fill 🎯');
        if (!isLong && gapMid < rEntry) snapTP3(gapMid, 'CME Gap Fill 🎯');
    }

    // C14. Weekly/Monthly targets — big-picture TP3 (if more realistic than current)
    if (weeklyTgts) {
        const wTarget = isLong ? parseFloat(weeklyTgts.weeklyHigh) : parseFloat(weeklyTgts.weeklyLow);
        if (wTarget && isFinite(wTarget)) snapTP3(wTarget, 'Weekly Target TP3 📅');
    }

    // C15. Gann extension levels — 2x1 and 3x1 Gann projections
    if (gannAngles?.targetAbove && isLong) {
        snapTP3(parseFloat(gannAngles.targetAbove), 'Gann Extension TP3');
    }
    if (gannAngles?.targetBelow && !isLong) {
        snapTP3(parseFloat(gannAngles.targetBelow), 'Gann Extension TP3');
    }

    // C16. Dynamic dynR2/dynS2 (Keltner 2× ATR band) = extended TP zone
    if (dynamicSR) {
        if (isLong  && dynamicSR.dynR2) snapTP3(parseFloat(dynamicSR.dynR2), 'Keltner 2ATR TP3');
        if (!isLong && dynamicSR.dynS2) snapTP3(parseFloat(dynamicSR.dynS2), 'Keltner 2ATR TP3');
    }

    // ─────────────────────────────────────────────────────────────
    // SECTION D: FINAL SAFETY VALIDATION
    // All levels must be logically consistent after all refinements
    // ─────────────────────────────────────────────────────────────
    if (isLong) {
        if (!isFinite(rSL)  || isNaN(rSL)  || rSL  >= rEntry) rSL  = rEntry - risk;
        if (!isFinite(rTP1) || isNaN(rTP1) || rTP1 <= rEntry) rTP1 = rEntry + risk * 2;
        if (!isFinite(rTP2) || isNaN(rTP2) || rTP2 <= rTP1)  rTP2 = rTP1  + risk;
        if (!isFinite(rTP3) || isNaN(rTP3) || rTP3 <= rTP2)  rTP3 = rTP2  + risk * 2;
    } else {
        if (!isFinite(rSL)  || isNaN(rSL)  || rSL  <= rEntry) rSL  = rEntry + risk;
        if (!isFinite(rTP1) || isNaN(rTP1) || rTP1 >= rEntry) rTP1 = rEntry - risk * 2;
        if (!isFinite(rTP2) || isNaN(rTP2) || rTP2 >= rTP1)  rTP2 = rTP1  - risk;
        if (!isFinite(rTP3) || isNaN(rTP3) || rTP3 >= rTP2)  rTP3 = rTP2  - risk * 2;
    }

    return {
        entry:    rEntry.toFixed(4),
        sl:       rSL.toFixed(4),  slLabel:  rSLLabel,
        tp1:      rTP1.toFixed(4), tp1Label: rTP1Label,
        tp2:      rTP2.toFixed(4), tp2Label: rTP2Label,
        tp3:      rTP3.toFixed(4), tp3Label: rTP3Label,
        refinements,
        wasRefined:      refinements.length > 0,
        refinementNote:  refinements.length > 0
            ? `🔧 ${refinements.length} refinements: ${refinements.slice(0, 3).join(' | ')}${refinements.length > 3 ? ` (+${refinements.length - 3} more)` : ''}`
            : null
    };
}

async function run14FactorAnalysis(coin, timeframe = '15m') {
    // ✅ FIX: Master 30s timeout — prevents infinite hang on any internal step
    // If any REST call or calculation hangs, user gets a clear error instead of silence
    return await Promise.race([
        _run14FactorAnalysisImpl(coin, timeframe),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Analysis timeout (30s) — Binance API slow or unreachable. Try again.`)), 30000)
        )
    ]);
}

async function _run14FactorAnalysisImpl(coin, timeframe = '15m') {

    // ── 1. Data Fetching (from live WS cache — zero REST polling) ─
    // ✅ FIX: Promise.all → individual .catch(null) so a single TF failure
    // (network blip, rate limit) does NOT abort the whole analysis.
    // Only the primary timeframe is required — others gracefully degrade.
    const [currentCandles, candles5m, candles1H, candles4H, candlesDaily] = await Promise.all([
        binance.getKlineDataFromCache(coin, timeframe, 500),
        binance.getKlineDataFromCache(coin, '5m',     500).catch(() => null),
        binance.getKlineDataFromCache(coin, '1h',     60).catch(() => null),
        binance.getKlineDataFromCache(coin, '4h',     80).catch(() => null),
        binance.getKlineDataFromCache(coin, '1d',     60).catch(() => null),  // 60 needed for EMA50 daily trend
    ]);

    // ✅ FIX: Guard — if primary candles failed, throw useful error
    if (!currentCandles || currentCandles.length < 10) {
        throw new Error(`${coin} ${timeframe} candle data unavailable — Binance API unreachable or coin invalid`);
    }

    const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]);
    const priceStr     = currentPrice.toFixed(4);

    // ── 2. Core Indicators ───────────────────────────────────────
    const ema200 = parseFloat(indicators.calculateEMA(currentCandles, 200));
    const ema50  = parseFloat(indicators.calculateEMA(currentCandles.slice(-100), 50));
    // ✅ FIX: Null-safe — candles1H/4H/5m may be null if that TF fetch failed
    const ema1H  = candles1H ? parseFloat(indicators.calculateEMA(candles1H, 50)) : ema200;
    const ema4H  = candles4H ? parseFloat(indicators.calculateEMA(candles4H, 50)) : ema200;

    const trend1H = candles1H && candles1H.length > 0
        ? (parseFloat(candles1H[candles1H.length - 1][4]) > ema1H ? 'Bullish 🟢' : 'Bearish 🔴')
        : (currentPrice > ema200 ? 'Bullish 🟢' : 'Bearish 🔴');
    const trend4H = candles4H && candles4H.length > 0
        ? (parseFloat(candles4H[candles4H.length - 1][4]) > ema4H ? 'Bullish 🟢' : 'Bearish 🔴')
        : trend1H;
    const mainTrend = currentPrice > ema200 ? 'Bullish 🟢' : 'Bearish 🔴';
    const direction = mainTrend.includes('Bullish') ? 'LONG' : 'SHORT';

    // ── 3. Market State & Choppy Detection ──────────────────────
    const adxData = indicators.calculateADX(currentCandles.slice(-50));
    const isHTFAligned =
        (trend1H.includes('Bullish') && trend4H.includes('Bullish')) ||
        (trend1H.includes('Bearish') && trend4H.includes('Bearish'));

    let marketState  = 'TRENDING 🚀';
    let isTrueChoppy = false;
    if (!adxData.isStrong) {
        if (isHTFAligned) marketState = `CONSOLIDATION ⏳ (${trend4H.includes('Bullish') ? 'Bull Flag' : 'Bear Flag'})`;
        else              { marketState = 'TRUE CHOPPY ⚖️ (Grid Mode Active)'; isTrueChoppy = true; }
    }

    // ── 4. Advanced Metrics & SMC (15m / primary TF) ─────────────
    const rsi             = indicators.calculateRSI(currentCandles.slice(-50), 14);
    const atr             = indicators.calculateATR(currentCandles.slice(-50));
    const atrVal          = parseFloat(atr);
    const macd            = indicators.calculateMACD(currentCandles.slice(-50));
    const vwap            = indicators.calculateVWAP(currentCandles);
    const poc             = indicators.calculatePOC(currentCandles.slice(-50));
    const pattern         = indicators.checkCandlePattern(currentCandles.slice(-10));
    const volBreak        = indicators.checkVolumeBreakout(currentCandles.slice(-50));
    const divergence      = indicators.checkDivergence(currentCandles.slice(-50));
    const harmonicPattern = indicators.checkHarmonicPattern(currentCandles.slice(-100));
    const ictSilverBullet = indicators.checkICTSilverBullet(currentCandles.slice(-10));
    const marketSMC       = smc.analyzeSMC(currentCandles.slice(-50));
    const mtf5m           = indicators.confirmEntry5m(candles5m, direction);

    // v4 precision — primary TF liquidity sweep + ChoCH
    const liquiditySweep = smc.checkLiquiditySweep(currentCandles.slice(-15));
    const choch          = smc.checkChoCH(currentCandles.slice(-20));
    const mtfOBsExtra    = detectMTFOBs(currentCandles.slice(-15));

    // v4 precision indicators
    const stochRSI  = calculateStochRSI(currentCandles.slice(-60));
    const bbands    = calculateBollingerBands(currentCandles.slice(-30));
    const mtfOB     = detectMTFOrderBlocks(currentCandles.slice(-30), (candles1H || currentCandles).slice(-20));

    // v4 advanced entry confirmation
    const mtfRSI     = checkMTFRSIConfluence(currentCandles.slice(-50), (candles1H || currentCandles).slice(-50));
    const volNodes   = detectVolumeNodes(currentCandles.slice(-100));
    const session    = getSessionQuality();
    const candleConf = checkCandleCloseConfirmation(currentCandles.slice(-5), direction, null);

    // v4 Key S/R, EMA Ribbon, FVG (primary TF)
    const keyLevels  = getKeyLevels(currentCandles.slice(-100));
    const emaRibbon  = getEMARibbon(currentCandles);
    const fvgData    = scanFairValueGaps(currentCandles.slice(-50));

    // v4 additions
    const supertrend = calculateSupertrend(currentCandles.slice(-60));
    const rvol       = calculateRVOL(currentCandles.slice(-30));
    const mtfMACD    = checkMTFMACD(currentCandles.slice(-60), (candles1H || currentCandles).slice(-60));

    // v5 world-class indicators
    const wyckoff    = detectWyckoffPhase(currentCandles.slice(-55));
    const breakers   = detectBreakerBlocks(currentCandles.slice(-40));
    const equalHL    = detectEqualHighsLows(currentCandles.slice(-60));
    const pdZone     = checkPremiumDiscount(currentCandles.slice(-60), direction);
    const williamsR  = calculateWilliamsR(currentCandles.slice(-20));
    const ichimoku   = calculateIchimoku(currentCandles.slice(-60));
    const heikinAshi = getHeikinAshiTrend(currentCandles.slice(-15));
    const cvd        = approximateCVD(currentCandles.slice(-30));
    const pivots     = calculatePivotPoints(candlesDaily);
    const pivotSignal = getPivotSignal(currentPrice, pivots, direction);
    const fibConf    = checkFibConfluence(currentCandles.slice(-60), direction);

    // ── 4b. 5m SNIPER LAYER ──────────────────────────────────────
    // MUST be calculated BEFORE v6 indicators (trend5m used by tf3Align)

    // ✅ FIX: null-safe 5m block — fallback to primary TF if 5m unavailable
    const safe5m       = candles5m && candles5m.length >= 10 ? candles5m : currentCandles;
    const ob5m         = detectMTFOBs(safe5m.slice(-20));
    const choch5m      = smc.checkChoCH(safe5m.slice(-25));
    const sweep5m      = smc.checkLiquiditySweep(safe5m.slice(-15));
    const fvg5m        = scanFairValueGaps(safe5m.slice(-60));
    const smc5m        = smc.analyzeSMC(safe5m.slice(-50));
    const ema21_5m     = parseFloat(indicators.calculateEMA(safe5m.slice(-30), 21));
    const price5mClose = candles5m && candles5m.length > 0 ? parseFloat(candles5m[candles5m.length - 1][4]) : currentPrice;
    const trend5m      = price5mClose > ema21_5m ? 'Bullish 🟢' : 'Bearish 🔴';

    // ── 4c. HTF OB Detection (needs trend5m above) ───────────────
    const ob4H  = detectMTFOBs((candles4H || currentCandles).slice(-20));
    const ob1H  = detectMTFOBs((candles1H || currentCandles).slice(-20));
    const ob15m = detectMTFOBs(currentCandles.slice(-20));

    // ── 4d. 15m ChoCH / Sweep for classification ─────────────────
    const choch15m = smc.checkChoCH(currentCandles.slice(-20));
    const sweep15m = smc.checkLiquiditySweep(currentCandles.slice(-15));

    // ── v6 BIG PROFIT INDICATORS (trend5m now available) ─────────
    const bbSqueeze    = detectBBSqueezeExplosion(currentCandles.slice(-60));
    const volExpansion = detectVolatilityExpansion(currentCandles.slice(-70));
    const mmTrap       = detectMarketMakerTrap(currentCandles.slice(-25));
    const weeklyTgts   = getWeeklyMonthlyTargets(candlesDaily, direction, currentPrice);
    const cmeGap       = detectCMEGap(candlesDaily, currentPrice);
    const tf3Align     = check3TFAlignment(trend5m, mainTrend, trend1H);  // trend5m now defined ✅

    // HTF Daily trend gate
    const dailyClose   = candlesDaily && candlesDaily.length >= 2
        ? parseFloat(candlesDaily[candlesDaily.length - 1][4])
        : currentPrice;
    const dailyEma50   = candlesDaily && candlesDaily.length >= 50
        ? parseFloat(indicators.calculateEMA(candlesDaily, 50))
        : null;
    const dailyTrend   = dailyEma50
        ? (dailyClose > dailyEma50 ? 'Bullish 🟢' : 'Bearish 🔴')
        : 'Unknown ⚪';
    const dailyAligned = dailyTrend !== 'Unknown ⚪'
        && ((direction === 'LONG'  && dailyTrend.includes('Bullish'))
        ||  (direction === 'SHORT' && dailyTrend.includes('Bearish')));

    // ── v7 PRO VVIP INDICATORS ───────────────────────────────────
    const gannAngles    = calculateGannAngles(currentCandles.slice(-60));
    const renko         = calculateRenko(currentCandles.slice(-80));
    const moonCycle     = getMoonCycle();
    const dynamicSR     = getDynamicSR(currentCandles.slice(-60));
    const bos           = detectBOS(currentCandles.slice(-30));
    const advCandles    = scanAdvancedCandlePatterns(currentCandles.slice(-5));
    const fibLevels     = getFibonacciLevels(currentCandles.slice(-100), direction);
    const mfi           = calculateMFI(currentCandles.slice(-20));
    const roc           = calculateROC(currentCandles.slice(-20));
    const cci           = calculateCCI(currentCandles.slice(-25));
    const momentumShift = detectMomentumShift(currentCandles.slice(-40));

    // ── 4e. MTF TRADE CLASSIFICATION ─────────────────────────────
    const tradeCategory = classifyTrade({
        currentPrice,
        direction,
        ob4H,
        ob1H,
        ob15m,
        ob5m,
        choch5m,
        choch15m,
        sweep5m,
        sweep15m,
    });

    // ── 5. Entry & Order Types ───────────────────────────────────
    const vwapMatch   = vwap.match(/\$([0-9.]+)/);
    const vwapPrice   = vwapMatch ? parseFloat(vwapMatch[1]) : 0;
    const obForDir    = direction === 'LONG' ? marketSMC.bullishOB : marketSMC.bearishOB;

    const bestEntry       = smc.selectBestEntry(priceStr, obForDir, marketSMC.fib618, poc, vwapPrice, direction, atrVal, harmonicPattern);
    const entryValidation = validateEntryPoint(bestEntry.price, currentPrice, direction);
    const confirmation    = smc.checkOBConfirmation(currentCandles.slice(-5), obForDir, direction);
    const orderSuggestion = smc.getOrderTypeSuggestion(bestEntry.price, currentPrice, direction);

    // ── 6. Smart SL / TP Calculation ────────────────────────────
    const entryPrice  = parseFloat(bestEntry.price);
    const smartSLData = calculateSmartSL(entryPrice, direction, currentCandles.slice(-30), obForDir, atrVal);
    const sl          = parseFloat(smartSLData.sl);
    const slLabel     = smartSLData.slLabel;
    const smartTPData = calculateSmartTPs(entryPrice, sl, direction, currentCandles.slice(-50));
    const tp1         = parseFloat(smartTPData.tp1);
    const tp2         = parseFloat(smartTPData.tp2);
    const tp3         = parseFloat(smartTPData.tp3);

    // ── 6b. Indicator-Based Refinement ──────────────────────────
    // Post-processes Entry/SL/TP using ALL computed indicators.
    // Zero extra API calls — all data available from steps 4/4b/4c/4d/4e/v7.
    const refined = refineTradeParameters({
        entry: entryPrice, sl, slLabel,
        tp1, tp1Label: smartTPData.tp1Label,
        tp2, tp2Label: smartTPData.tp2Label,
        tp3, tp3Label: smartTPData.tp3Label,
        direction, atrVal, currentPrice,
        // v1-v5
        ichimoku, supertrend, wyckoff, pivots, equalHL, breakers, fibConf,
        // v4/v6
        mtfOB, fvgData, volNodes, bbands, rvol, adxData, session,
        weeklyTgts, cmeGap, heikinAshi,
        // v7
        dynamicSR, fibLevels, mfi, williamsR, advCandles, gannAngles, bos,
    });

    // ── 7. 14-FACTOR + 5m SNIPER SCORING SYSTEM ─────────────────
    let longScore = 0, shortScore = 0, longR = [], shortR = [];

    // ── Trend confluence ──
    if (trend4H.includes('Bullish') && trend1H.includes('Bullish'))  { longScore++;  longR.push('MTF Bull'); }
    if (trend4H.includes('Bearish') && trend1H.includes('Bearish'))  { shortScore++; shortR.push('MTF Bear'); }
    if (currentPrice > ema200 && Math.abs(currentPrice - ema50) / ema50 < 0.003) { longScore++;  longR.push('EMA Pullback'); }
    if (currentPrice < ema200 && Math.abs(currentPrice - ema50) / ema50 < 0.003) { shortScore++; shortR.push('EMA Pullback'); }

    // ── SMC Order Blocks (primary TF) ──
    if (marketSMC.bullishOB) { longScore++;  longR.push('Bull OB'); }
    if (marketSMC.bearishOB) { shortScore++; shortR.push('Bear OB'); }

    // ── RSI ──
    if (rsi < 45) { longScore++;  longR.push('RSI Oversold'); }
    if (rsi > 55) { shortScore++; shortR.push('RSI Overbought'); }

    // ── VWAP ──
    if (vwap.includes('🟢')) { longScore++;  longR.push('Above VWAP'); }
    if (vwap.includes('🔴')) { shortScore++; shortR.push('Below VWAP'); }

    // ── Candle Pattern ──
    if (pattern.includes('🟢')) { longScore++;  longR.push(pattern.split(' ')[0]); }
    if (pattern.includes('🔴')) { shortScore++; shortR.push(pattern.split(' ')[0]); }

    // ── Volume ──
    if (volBreak.includes('Bullish Breakout')) { longScore++;  longR.push('Vol Spike'); }
    if (volBreak.includes('Bearish Breakout')) { shortScore++; shortR.push('Vol Spike'); }

    // ── Divergence ──
    if (divergence.includes('Bullish')) { longScore++;  longR.push('Divergence'); }
    if (divergence.includes('Bearish')) { shortScore++; shortR.push('Divergence'); }

    // ── MACD ──
    if (macd.includes('Bullish')) { longScore++;  longR.push('MACD Bull'); }
    if (macd.includes('Bearish')) { shortScore++; shortR.push('MACD Bear'); }

    // ── Sweep / ChoCH (primary TF) ──
    if (marketSMC.sweep.includes('Bullish') || marketSMC.choch.includes('Bullish')) { longScore++;  longR.push('Sweep/ChoCH'); }
    if (marketSMC.sweep.includes('Bearish') || marketSMC.choch.includes('Bearish')) { shortScore++; shortR.push('Sweep/ChoCH'); }

    // ── OB Confirmation ──
    if (confirmation.confirmed) {
        if (direction === 'LONG') { longScore++;  longR.push('OB Touch ✅'); }
        else                      { shortScore++; shortR.push('OB Touch ✅'); }
    }

    // ── 5m Alignment (existing confirmEntry5m check) ──
    if (mtf5m.confirmed) {
        if (direction === 'LONG') { longScore++;  longR.push('5m Aligned ✅'); }
        else                      { shortScore++; shortR.push('5m Aligned ✅'); }
    }

    // ── Harmonic ──
    if (harmonicPattern.includes('Bullish')) { longScore++;  longR.push(harmonicPattern.split(' ')[1]); }
    if (harmonicPattern.includes('Bearish')) { shortScore++; shortR.push(harmonicPattern.split(' ')[1]); }

    // ── ICT Silver Bullet ──
    if (ictSilverBullet.includes('Bullish')) { longScore++;  longR.push('ICT Time 🎯'); }
    if (ictSilverBullet.includes('Bearish')) { shortScore++; shortR.push('ICT Time 🎯'); }

    // ── StochRSI ──
    if (stochRSI.isBull) { longScore++;  longR.push(`StochRSI ${stochRSI.signal}`); }
    if (stochRSI.isBear) { shortScore++; shortR.push(`StochRSI ${stochRSI.signal}`); }

    // ── Bollinger Bands ──
    if (bbands.isBull)  { longScore++;  longR.push('BB Lower Zone'); }
    if (bbands.isBear)  { shortScore++; shortR.push('BB Upper Zone'); }
    if (bbands.squeeze) { longScore += 0.5; shortScore += 0.5; }

    // ── MTF OB Confluence (15m + 1H overlap) ──
    if (mtfOB.confluenceZone) {
        if (mtfOB.confluenceZone.type === 'BULLISH') { longScore += 2;  longR.push('MTF OB Confluence 🔥'); }
        if (mtfOB.confluenceZone.type === 'BEARISH') { shortScore += 2; shortR.push('MTF OB Confluence 🔥'); }
    }

    // ── EMA Ribbon ──
    if (emaRibbon) {
        if (emaRibbon.signal === 'STRONG_BULL')   { longScore  += 2; longR.push('EMA Ribbon Bull 🟢🟢'); }
        if (emaRibbon.signal === 'STRONG_BEAR')   { shortScore += 2; shortR.push('EMA Ribbon Bear 🔴🔴'); }
        if (emaRibbon.signal === 'BULL_PULLBACK') { longScore++;     longR.push('EMA21 Pullback 🟡'); }
        if (emaRibbon.signal === 'BEAR_PULLBACK') { shortScore++;    shortR.push('EMA21 Pullback 🟡'); }
    }

    // ── MTF RSI ──
    if (mtfRSI.isBull) { longScore  += mtfRSI.signal === 'STRONG_BULL' ? 2 : 1; longR.push('MTF RSI Bull'); }
    if (mtfRSI.isBear) { shortScore += mtfRSI.signal === 'STRONG_BEAR' ? 2 : 1; shortR.push('MTF RSI Bear'); }

    // ── HVN ──
    if (volNodes.nearHVN) {
        if (direction === 'LONG') { longScore++;  longR.push('HVN Zone 🔥'); }
        else                      { shortScore++; shortR.push('HVN Zone 🔥'); }
    }

    // ── Session Quality ──
    if (session.isBestSession) {
        if (direction === 'LONG') { longScore  += 0.5; longR.push(`${session.emoji} ${session.session}`); }
        else                      { shortScore += 0.5; shortR.push(`${session.emoji} ${session.session}`); }
    }

    // ── Candle Close Confirmation ──
    if (candleConf.confirmed) {
        if (direction === 'LONG') { longScore++;  longR.push('Candle Close ✅'); }
        else                      { shortScore++; shortR.push('Candle Close ✅'); }
    }

    // ── Liquidity Sweep — primary TF ──
    if (liquiditySweep.includes('Bullish')) { longScore  += 2; longR.push('Liq Sweep 🟢'); }
    if (liquiditySweep.includes('Bearish')) { shortScore += 2; shortR.push('Liq Sweep 🔴'); }

    // ── ChoCH — primary TF ──
    if (choch.includes('Bullish')) { longScore  += 2; longR.push('ChoCH 🔄🟢'); }
    if (choch.includes('Bearish')) { shortScore += 2; shortR.push('ChoCH 🔄🔴'); }

    // ── Supertrend ──
    if (supertrend.justFlipUp)   { longScore  += 2; longR.push('Supertrend Flip 🟢🟢'); }
    else if (supertrend.isBull)  { longScore++;     longR.push('Supertrend Bull 🟢'); }
    if (supertrend.justFlipDown) { shortScore += 2; shortR.push('Supertrend Flip 🔴🔴'); }
    else if (supertrend.isBear)  { shortScore++;    shortR.push('Supertrend Bear 🔴'); }

    // ── RVOL ──
    if (rvol.signal === 'EXTREME' || rvol.signal === 'HIGH') {
        longScore += 0.5; shortScore += 0.5;
        longR.push('RVOL High 🔥'); shortR.push('RVOL High 🔥');
    }

    // ── MTF MACD ──
    if (mtfMACD.signal === 'STRONG_BULL') { longScore  += 2; longR.push('MTF MACD Bull 🟢🟢'); }
    if (mtfMACD.signal === 'STRONG_BEAR') { shortScore += 2; shortR.push('MTF MACD Bear 🔴🔴'); }

    // ── Extra MTF OBs (primary TF short-term) ──
    if (mtfOBsExtra.bullish && direction === 'LONG')  { longScore++;  longR.push('Short OB 🟢'); }
    if (mtfOBsExtra.bearish && direction === 'SHORT') { shortScore++; shortR.push('Short OB 🔴'); }

    // ════════════════════════════════════════════
    // v5 WORLD-CLASS SCORING FACTORS
    // ════════════════════════════════════════════

    // Wyckoff Phase
    if      (wyckoff.phase === 'SPRING')       { longScore  += 3; longR.push('Wyckoff Spring 🌱🌱🌱'); }
    else if (wyckoff.phase === 'MARKUP')       { longScore++;     longR.push('Wyckoff Markup 📈'); }
    else if (wyckoff.phase === 'ACCUMULATION') { longScore  += 0.5; longR.push('Wyckoff Accum 🔄'); }
    if      (wyckoff.phase === 'UTAD')         { shortScore += 3; shortR.push('Wyckoff UTAD ⚡⚡⚡'); }
    else if (wyckoff.phase === 'MARKDOWN')     { shortScore++;    shortR.push('Wyckoff Markdown 📉'); }
    else if (wyckoff.phase === 'DISTRIBUTION') { shortScore += 0.5; shortR.push('Wyckoff Dist 🔄'); }

    // Breaker Blocks
    if (breakers.bullishBreaker && direction === 'LONG')  { longScore  += 2; longR.push('Bull Breaker 🔲'); }
    if (breakers.bearishBreaker && direction === 'SHORT') { shortScore += 2; shortR.push('Bear Breaker 🔲'); }

    // EQH / EQL
    if (equalHL.eql && direction === 'LONG')  { longScore++;  longR.push('EQL Below 💧'); }
    if (equalHL.eqh && direction === 'SHORT') { shortScore++; shortR.push('EQH Above 💧'); }

    // Premium / Discount Zone
    if (pdZone.zone === 'OTE') {
        longScore += 2; shortScore += 2;
        longR.push('OTE Zone 🎯'); shortR.push('OTE Zone 🎯');
    } else if (pdZone.tradeMatch) {
        if (direction === 'LONG') { longScore++;  longR.push('Discount Zone 🟢'); }
        else                      { shortScore++; shortR.push('Premium Zone 🔴'); }
    } else if (!pdZone.tradeMatch && pdZone.zone !== 'EQUILIBRIUM' && pdZone.zone !== 'UNKNOWN') {
        if (direction === 'LONG')  longScore  = Math.max(0, longScore  - 1);
        if (direction === 'SHORT') shortScore = Math.max(0, shortScore - 1);
    }

    // Fibonacci Confluence
    if (fibConf.hasConfluence) {
        if (direction === 'LONG') { longScore  += 2; longR.push(`Fib Confluence ${fibConf.count}× 🔢`); }
        else                      { shortScore += 2; shortR.push(`Fib Confluence ${fibConf.count}× 🔢`); }
    }

    // Daily Pivot
    if (pivotSignal.isBull) { longScore++;  longR.push(`Pivot ${pivotSignal.nearLevel?.name || ''} Support 📌`); }
    if (pivotSignal.isBear) { shortScore++; shortR.push(`Pivot ${pivotSignal.nearLevel?.name || ''} Resist 📌`); }

    // Ichimoku
    if      (ichimoku.signal === 'STRONG_BULL') { longScore  += 2; longR.push('Ichimoku Bull Cross ☁️🚀'); }
    else if (ichimoku.signal === 'BULL')        { longScore++;     longR.push('Ichimoku Bull ☁️🟢'); }
    else if (ichimoku.signal === 'MILD_BULL')   { longScore  += 0.5; }
    if      (ichimoku.signal === 'STRONG_BEAR') { shortScore += 2; shortR.push('Ichimoku Bear Cross ☁️📉'); }
    else if (ichimoku.signal === 'BEAR')        { shortScore++;    shortR.push('Ichimoku Bear ☁️🔴'); }
    else if (ichimoku.signal === 'MILD_BEAR')   { shortScore += 0.5; }
    if (ichimoku.inCloud) {
        longScore  = Math.max(0, longScore  - 1);
        shortScore = Math.max(0, shortScore - 1);
    }

    // CVD
    if      (cvd.bullDiv)           { longScore  += 2; longR.push('CVD Bull Div 📊🚀'); }
    else if (cvd.trend === 'BULL')  { longScore++;     longR.push('CVD Rising 📊🟢'); }
    if      (cvd.bearDiv)           { shortScore += 2; shortR.push('CVD Bear Div 📊⚠️'); }
    else if (cvd.trend === 'BEAR')  { shortScore++;    shortR.push('CVD Falling 📊🔴'); }

    // Heikin Ashi
    if (heikinAshi.isStrong && heikinAshi.isBull) { longScore++;  longR.push(`HA ${heikinAshi.consecutive}× Bull 🕯️`); }
    if (heikinAshi.isStrong && heikinAshi.isBear) { shortScore++; shortR.push(`HA ${heikinAshi.consecutive}× Bear 🕯️`); }

    // Williams %R
    if (williamsR.isBull) { longScore++;  longR.push(`W%R ${williamsR.value} 🟢`); }
    if (williamsR.isBear) { shortScore++; shortR.push(`W%R ${williamsR.value} 🔴`); }

    // ════════════════════════════════════════════
    // v6 BIG-PROFIT SCORING FACTORS
    // ════════════════════════════════════════════

    // BB Squeeze Explosion — highest energy release signal
    if (bbSqueeze.exploding) {
        if (bbSqueeze.explosionDir === 'BULL') { longScore  += 3; longR.push('BB Explosion 💥🟢'); }
        else                                   { shortScore += 3; shortR.push('BB Explosion 💥🔴'); }
    } else if (bbSqueeze.isSqueezing && bbSqueeze.squeezeDuration >= 3) {
        longScore += 1; shortScore += 1;  // +1 to both: breakout imminent, direction unknown
        longR.push('BB Squeeze ⚡'); shortR.push('BB Squeeze ⚡');
    }

    // Volatility Expansion — ADX surge = trend just started
    if (volExpansion.justStarted) {
        // "Just started" = earliest entry into a new trend = max reward
        if (direction === 'LONG') { longScore  += 3; longR.push('Trend Start! ADX⚡'); }
        else                      { shortScore += 3; shortR.push('Trend Start! ADX⚡'); }
    } else if (volExpansion.expanding) {
        if (direction === 'LONG') { longScore  += 1; longR.push('Volatility Expanding 📈'); }
        else                      { shortScore += 1; shortR.push('Volatility Expanding 📉'); }
    }

    // Market Maker Trap — high probability reversal
    if (mmTrap.bearTrap && direction === 'LONG')  { longScore  += 3; longR.push('Bear Trap! LONG 🪤'); }
    if (mmTrap.bullTrap && direction === 'SHORT') { shortScore += 3; shortR.push('Bull Trap! SHORT 🪤'); }

    // 3-Timeframe Alignment
    if (tf3Align.aligned) {
        if (tf3Align.allBull) { longScore  += 2; longR.push('3TF Aligned 🟢🟢🟢'); }
        if (tf3Align.allBear) { shortScore += 2; shortR.push('3TF Aligned 🔴🔴🔴'); }
    }

    // HTF Daily Trend Gate — trading with daily trend = much higher win rate
    if (dailyAligned) {
        if (direction === 'LONG') { longScore  += 2; longR.push('Daily Trend ✅'); }
        else                      { shortScore += 2; shortR.push('Daily Trend ✅'); }
    } else if (dailyTrend !== 'Unknown ⚪') {
        // Against daily trend = significant penalty
        if (direction === 'LONG')  longScore  = Math.max(0, longScore  - 2);
        if (direction === 'SHORT') shortScore = Math.max(0, shortScore - 2);
    }

    // CME Gap as TP magnet (bonus score for gap alignment)
    if (cmeGap.hasGap && !cmeGap.filled) {
        const gapDir = cmeGap.gapAbove ? 'LONG' : 'SHORT'; // gap above = price likely goes up
        if (gapDir === direction) {
            if (direction === 'LONG') { longScore  += 1; longR.push('CME Gap Target 🎯'); }
            else                      { shortScore += 1; shortR.push('CME Gap Target 🎯'); }
        }
    }

    // Weekly target within reach (+1 if TP2 or beyond could hit weekly level)
    if (weeklyTgts && weeklyTgts.nearTarget) {
        const tpDist  = Math.abs(tp2 - currentPrice) / currentPrice;
        const wkDist  = Math.abs(weeklyTgts.nearTarget - currentPrice) / currentPrice;
        if (wkDist <= tpDist * 1.5) { // weekly target within 1.5× of TP2 distance
            if (direction === 'LONG') { longScore++;  longR.push('Weekly Level TP 🗓️'); }
            else                      { shortScore++; shortR.push('Weekly Level TP 🗓️'); }
        }
    }

    // ════════════════════════════════════════════
    // v7 PRO VVIP SCORING FACTORS
    // ════════════════════════════════════════════

    // Gann Angles — geometric price/time structure
    if (gannAngles.signal === 'STRONG_BULL') { longScore  += 2; longR.push('Gann Strong Bull 📐🟢'); }
    else if (gannAngles.isBull)              { longScore++;     longR.push('Gann Bull 📐'); }
    if (gannAngles.signal === 'STRONG_BEAR') { shortScore += 2; shortR.push('Gann Strong Bear 📐🔴'); }
    else if (gannAngles.isBear)              { shortScore++;    shortR.push('Gann Bear 📐'); }

    // Renko — noise-filtered trend (strongest signal is reversal)
    if (renko.reversal && renko.isBull) { longScore  += 3; longR.push('Renko Bull Reversal 🧱🚀'); }
    else if (renko.isBull && renko.streak >= 3) { longScore++; longR.push(`Renko ${renko.streak}× Bull 🧱`); }
    if (renko.reversal && renko.isBear) { shortScore += 3; shortR.push('Renko Bear Reversal 🧱📉'); }
    else if (renko.isBear && renko.streak >= 3) { shortScore++; shortR.push(`Renko ${renko.streak}× Bear 🧱`); }

    // Moon Cycle — macro sentiment filter (minor bonus/penalty)
    if (moonCycle.isBull && direction === 'LONG')   { longScore  += 0.5; longR.push(`${moonCycle.emoji} Moon Bull`); }
    if (moonCycle.isBear && direction === 'SHORT')  { shortScore += 0.5; shortR.push(`${moonCycle.emoji} Moon Bear`); }
    if (moonCycle.isFullMoon) {
        // Full moon = historically BTC peaks = mild warning for longs
        if (direction === 'LONG') longScore = Math.max(0, longScore - 0.5);
    }

    // Dynamic S/R — ATR-adjusted fractal levels
    if (dynamicSR.nearSupport && direction === 'LONG')  { longScore++;  longR.push('Dynamic Support 📊'); }
    if (dynamicSR.nearResist  && direction === 'SHORT') { shortScore++; shortR.push('Dynamic Resist 📊'); }
    // Penalty if price is at dynamic resistance for longs, or support for shorts
    if (dynamicSR.nearResist  && direction === 'LONG')  longScore  = Math.max(0, longScore  - 1);
    if (dynamicSR.nearSupport && direction === 'SHORT') shortScore = Math.max(0, shortScore - 1);

    // BOS (Break of Structure) — trend continuation confirmation
    if (bos.bullBOS) { longScore  += 2; longR.push('Bull BOS 🔺'); }
    if (bos.bearBOS) { shortScore += 2; shortR.push('Bear BOS 🔻'); }

    // Advanced Candle Patterns — institutional-grade patterns
    if (advCandles.isBull) {
        const pts = ['Morning Star','Three White Soldiers','Dragonfly Doji'].some(p => advCandles.pattern?.includes(p)) ? 2 : 1;
        longScore  += pts; longR.push(`${advCandles.pattern} 🕯️`);
    }
    if (advCandles.isBear) {
        const pts = ['Evening Star','Three Black Crows','Gravestone Doji'].some(p => advCandles.pattern?.includes(p)) ? 2 : 1;
        shortScore += pts; shortR.push(`${advCandles.pattern} 🕯️`);
    }

    // Fibonacci Levels — at OTE zone (61.8/78.6% retracement)
    if (fibLevels.isAtOTE) {
        if (direction === 'LONG') { longScore  += 2; longR.push('At OTE Fib Zone 🎯'); }
        else                      { shortScore += 2; shortR.push('At OTE Fib Zone 🎯'); }
    }

    // MFI (Money Flow Index) — volume-weighted smart money signal
    if (mfi.value < 20 && mfi.isBull) { longScore  += 2; longR.push('MFI Oversold 💰🟢'); }
    else if (mfi.isBull)              { longScore++;     longR.push('MFI Bull 💰'); }
    if (mfi.value > 80 && mfi.isBear) { shortScore += 2; shortR.push('MFI Overbought 💰🔴'); }
    else if (mfi.isBear)              { shortScore++;    shortR.push('MFI Bear 💰'); }

    // ROC (Rate of Change) — momentum velocity
    if (roc.isBull && roc.value > 0)  { longScore++;  longR.push(`ROC +${roc.value.toFixed(1)}% ⚡`); }
    if (roc.isBear && roc.value < 0)  { shortScore++; shortR.push(`ROC ${roc.value.toFixed(1)}% ⚡`); }
    // Zero-cross = fresh momentum start = strong signal
    if (roc.signal?.includes('Bullish Cross')) { longScore++;  longR.push('ROC Zero Cross 🟢'); }
    if (roc.signal?.includes('Bearish Cross')) { shortScore++; shortR.push('ROC Zero Cross 🔴'); }

    // CCI (Commodity Channel Index)
    if (cci.value < -200)       { longScore  += 2; longR.push('CCI Extreme Oversold 📊🟢🟢'); }
    else if (cci.value < -100)  { longScore++;     longR.push('CCI Oversold 📊🟢'); }
    else if (cci.isBull)        { longScore  += 0.5; }
    if (cci.value > 200)        { shortScore += 2; shortR.push('CCI Extreme Overbought 📊🔴🔴'); }
    else if (cci.value > 100)   { shortScore++;    shortR.push('CCI Overbought 📊🔴'); }
    else if (cci.isBear)        { shortScore += 0.5; }

    // Momentum Shift — unified signal across ROC+MFI+StochRSI+CCI
    // 4+/6 = strong, 6/6 = maximum conviction
    if (momentumShift.isBull) {
        const pts = momentumShift.bullSignals >= 6 ? 3 : momentumShift.bullSignals >= 5 ? 2 : 1;
        longScore  += pts; longR.push(`Momentum BULL ${momentumShift.bullSignals}/6 ⚡🟢`);
    }
    if (momentumShift.isBear) {
        const pts = momentumShift.bearSignals >= 6 ? 3 : momentumShift.bearSignals >= 5 ? 2 : 1;
        shortScore += pts; shortR.push(`Momentum BEAR ${momentumShift.bearSignals}/6 ⚡🔴`);
    }

    // ════════════════════════════════════════════
    // ⚡ 5m SNIPER LAYER — SCORING BONUSES
    // These factors are in addition to the 14 base factors above.
    // They reward high-confluence setups where the 5m microstructure
    // aligns with the primary timeframe bias — the sniper entry signal.
    // ════════════════════════════════════════════

    // 5m ChoCH (Change of Character) — strongest sniper trigger
    // A ChoCH on 5m means institutional participants have flipped structure
    // on the lowest granularity, confirming the higher-TF move is starting NOW.
    if (choch5m.includes('Bullish')) {
        longScore  += 2;
        longR.push('5m ChoCH 🔄🟢⚡');
    }
    if (choch5m.includes('Bearish')) {
        shortScore += 2;
        shortR.push('5m ChoCH 🔄🔴⚡');
    }

    // 5m Liquidity Sweep — institutional stop-hunt confirmation on 5m
    // Price swept below (LONG) or above (SHORT) recent 5m liquidity before reversing
    if (sweep5m.includes('Bullish')) {
        longScore  += 2;
        longR.push('5m Liq Sweep 🟢⚡');
    }
    if (sweep5m.includes('Bearish')) {
        shortScore += 2;
        shortR.push('5m Liq Sweep 🔴⚡');
    }

    // 5m Order Block alignment — microstructure OB in trade direction
    if (ob5m.bullish && direction === 'LONG') {
        longScore++;
        longR.push('5m OB 🟢');
    }
    if (ob5m.bearish && direction === 'SHORT') {
        shortScore++;
        shortR.push('5m OB 🔴');
    }

    // 5m trend EMA alignment (price above/below 5m EMA21 confirms momentum)
    if (trend5m.includes('Bullish') && direction === 'LONG') {
        longScore  += 0.5;
        longR.push('5m EMA Trend 🟢');
    }
    if (trend5m.includes('Bearish') && direction === 'SHORT') {
        shortScore += 0.5;
        shortR.push('5m EMA Trend 🔴');
    }

    // Sniper category bonus: reward SWING and SCALP classifications
    // with a score bump because they require the highest confluence.
    if (tradeCategory.label.includes('SWING')) {
        if (direction === 'LONG') { longScore++;  longR.push('4H OB Sniper 📅'); }
        else                      { shortScore++; shortR.push('4H OB Sniper 📅'); }
    }
    if (tradeCategory.label.includes('SCALP')) {
        if (direction === 'LONG') { longScore++;  longR.push('15m OB Scalp ⚡'); }
        else                      { shortScore++; shortR.push('15m OB Scalp ⚡'); }
    }

    const finalScore   = direction === 'LONG' ? Math.floor(longScore) : Math.floor(shortScore);
    const finalReasons = (direction === 'LONG' ? longR : shortR).join(', ') || 'None';

    // ── SMART DIRECTION OVERRIDE ─────────────────────────────────
    // If scores clearly diverge (>2 pts gap), use the STRONGER score direction.
    // This catches cases where EMA200 says LONG but ALL indicators say SHORT.
    const smartDir = longScore >= shortScore ? 'LONG' : 'SHORT';
    const scoreDiff = Math.abs(longScore - shortScore);
    const bestDirection = scoreDiff >= 2 ? smartDir : direction;
    const bestScore   = bestDirection === 'LONG' ? Math.floor(longScore) : Math.floor(shortScore);
    const bestReasons = (bestDirection === 'LONG' ? longR : shortR).join(', ') || 'None';

    // ── MULTI-LAYER CONFIRMATION GATE ────────────────────────────
    // Counts how many HIGH-CONVICTION confirmations are present.
    // Used by scanner to filter signals: require confScore ≥ 2.
    const isL = bestDirection === 'LONG';
    const confChecks = {
        // v1-v4 base confirmations
        htfAligned:   (trend1H.includes('Bullish') && trend4H.includes('Bullish')) || (trend1H.includes('Bearish') && trend4H.includes('Bearish')),
        chochPrimary: choch.includes(isL ? 'Bullish' : 'Bearish'),
        sweepPrimary: liquiditySweep.includes(isL ? 'Bullish' : 'Bearish'),
        choch5mConf:  choch5m.includes(isL ? 'Bullish' : 'Bearish'),
        sweep5mConf:  sweep5m.includes(isL ? 'Bullish' : 'Bearish'),
        volumeConf:   volBreak.includes(isL ? 'Bullish' : 'Bearish') || rvol.signal === 'HIGH' || rvol.signal === 'EXTREME',
        dailyGate:    dailyAligned,
        // v5 world-class
        wyckoffConf:  (isL && (wyckoff.phase === 'SPRING' || wyckoff.phase === 'MARKUP')) || (!isL && (wyckoff.phase === 'UTAD' || wyckoff.phase === 'MARKDOWN')),
        ichimokuConf: (isL && (ichimoku.signal === 'STRONG_BULL' || ichimoku.signal === 'BULL')) || (!isL && (ichimoku.signal === 'STRONG_BEAR' || ichimoku.signal === 'BEAR')),
        supTrendConf: (isL && (supertrend.isBull || supertrend.justFlipUp)) || (!isL && (supertrend.isBear || supertrend.justFlipDown)),
        fibZoneConf:  fibConf.hasConfluence,
        // v6 big-profit
        bbExplosion:  bbSqueeze.exploding && ((isL && bbSqueeze.explosionDir === 'BULL') || (!isL && bbSqueeze.explosionDir === 'BEAR')),
        mmTrapConf:   (isL && mmTrap.bearTrap) || (!isL && mmTrap.bullTrap),
        // v7 PRO VVIP
        bosConf:       isL ? bos.bullBOS : bos.bearBOS,
        renkoConf:     isL ? (renko.isBull && renko.streak >= 2) : (renko.isBear && renko.streak >= 2),
        momentumConf:  isL ? momentumShift.isBull : momentumShift.isBear,
        mfiConf:       isL ? (mfi.isBull && mfi.value < 35) : (mfi.isBear && mfi.value > 65),
        gannConf:      isL ? gannAngles.isBull : gannAngles.isBear,
        advCandleConf: isL ? advCandles.isBull : advCandles.isBear,
        dynamicSRConf: isL ? dynamicSR.nearSupport : dynamicSR.nearResist,
        oteFibConf:    fibLevels.isAtOTE,
    };
    const confScore = Object.values(confChecks).filter(Boolean).length;
    const confGate  = confScore >= 2; // minimum 2 high-conviction confirmations

    // ── 8. Return Master Object ──────────────────────────────────
    // All original fields preserved. New 5m sniper fields appended.
    return {
        // ── Core price & trend ──
        priceStr, currentPrice, currentCandles,
        direction, mainTrend, trend1H, trend4H, marketState, isTrueChoppy,

        // ── Primary-TF indicators ──
        adxData, rsi, vwap, macd, harmonicPattern, ictSilverBullet,
        marketSMC, mtf5m,

        // ── Entry zone & order management ──
        bestEntry, confirmation, orderSuggestion,
        entryPrice: refined.entry,
        sl:         refined.sl,
        slLabel:    refined.slLabel || 'ATR',
        tp1:        refined.tp1,    tp1Label: refined.tp1Label,
        tp2:        refined.tp2,    tp2Label: refined.tp2Label,
        tp3:        refined.tp3,    tp3Label: refined.tp3Label,

        // ── Refinement metadata ──
        refinements:     refined.refinements,      // array of what changed
        refinementNote:  refined.refinementNote,   // display string "🔧 Refined by: ..."
        wasRefined:      refined.wasRefined,        // true if any refinement applied

        // ── v4 precision data ──
        stochRSI, bbands, mtfOB, mtfOBsExtra,
        liquiditySweep, choch, entryValidation,

        // ── Scoring ──
        score: bestScore, maxScore: 100, reasons: bestReasons,
        direction: bestDirection,    // ✅ SMART: score-based direction (not just EMA200)
        emaDirection: direction,     // original EMA200 direction (for reference)
        longScore: Math.floor(longScore),
        shortScore: Math.floor(shortScore),

        // ── Confirmation Gate ── (used by scanner for quality filter)
        confScore,      // 0-21: number of high-conviction confirmations (v7 expanded)
        confGate,       // true = passes min 2 confirmations gate
        confChecks,     // detailed breakdown of each confirmation

        // ── v4 confirmation ──
        mtfRSI, volNodes, session, candleConf,
        keyLevels, emaRibbon, fvgData,
        supertrend, rvol, mtfMACD,

        // ── v5 world-class ──
        wyckoff, breakers, equalHL, pdZone,
        williamsR, ichimoku, heikinAshi, cvd,
        pivots, pivotSignal, fibConf,

        // ── ⚡ 5m Sniper Layer (NEW) ──────────────────────────────
        // MTF Trade Classification
        tradeCategory,          // { label, htfZone, confirmTF, holdTime, riskNote, emoji }

        // 5m raw SMC data
        ob5m,                   // { bullish: {bottom, top} | null, bearish: ... }
        choch5m,                // string — e.g. "Bullish ChoCH 🟢 (Structure Reversal Up)"
        sweep5m,                // string — e.g. "Bullish Sweep 🟢 (Sell-side Liquidity Taken)"
        fvg5m,                  // { bullFVGs: [], bearFVGs: [], nearest: null }
        smc5m,                  // full SMC object on 5m
        trend5m,                // "Bullish 🟢" or "Bearish 🔴"
        ema21_5m,               // numeric

        // HTF OB detection results used for classification
        ob4H,                   // detectMTFOBs result for 4H candles
        ob1H,                   // detectMTFOBs result for 1H candles
        ob15m,                  // detectMTFOBs result for 15m candles
        choch15m,               // 15m ChoCH string
        sweep15m,               // 15m Sweep string

        // ⚡ v6 BIG-PROFIT fields ─────────────────────────────────
        bbSqueeze,              // BB squeeze/explosion state
        volExpansion,           // ADX surge = trend just started
        mmTrap,                 // Market Maker Trap detector
        weeklyTgts,             // Weekly/monthly TP targets
        cmeGap,                 // CME gap fill target
        tf3Align,               // 3-TF alignment status
        dailyTrend,             // Daily EMA50 trend direction
        dailyAligned,           // true = trade WITH daily trend

        // 🔮 v7 PRO VVIP fields ────────────────────────────────────
        gannAngles,             // Gann angle zones (1x1, 2x1, etc)
        renko,                  // Renko noise-filtered trend + reversal
        moonCycle,              // Lunar cycle macro sentiment
        dynamicSR,              // ATR-adjusted fractal S/R levels
        bos,                    // Break of Structure (bull/bear BOS)
        advCandles,             // 15-pattern advanced candlestick scan
        fibLevels,              // Full fib levels + OTE zone detection
        mfi,                    // Money Flow Index (vol-weighted RSI)
        roc,                    // Rate of Change momentum
        cci,                    // Commodity Channel Index
        momentumShift,          // Unified momentum (ROC+MFI+StochRSI+CCI)
    };
} // end _run14FactorAnalysisImpl

module.exports = { run14FactorAnalysis };
