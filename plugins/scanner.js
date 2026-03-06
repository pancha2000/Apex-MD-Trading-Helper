/**
 * ═══════════════════════════════════════════════════════════════
 *  APEX-MD  ·  scanner.js  ·  Institutional-Grade Adaptive Edition
 *  ─────────────────────────────────────────────────────────────
 *  v7 UPGRADES:
 *  1. 📅 DAILY BIAS MASTER FILTER (Top-Down Analysis)
 *     • If Daily Bias = BULLISH  → All SHORT signals IGNORED
 *       Exception: ⚡ HIGH-PROB SCALP with score ≥ 45 bypasses filter
 *     • If Daily Bias = BEARISH  → All LONG signals IGNORED
 *       Exception: same high-score scalp exception
 *     • If Daily Bias = RANGING  → No filter applied (both directions ok)
 *
 *  2. Daily Bias shown in all scan output messages
 *  3. Golden Confluence tag shown in setup display
 *  4. Trade manager: saves closeMetadata on auto-close for backtesting
 *
 *  All prior event-driven WebSocket logic, trade manager, and
 *  funding alert command preserved exactly.
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const { cmd } = require('../lib/commands');
const config   = require('../config');
const db       = require('../lib/database');
const axios    = require('axios');
const binance  = require('../lib/binance');
const analyzer = require('../lib/analyzer');

// ─── Sentiment Cache ───────────────────────────────────────────
let cachedSentiment    = null;
let sentimentCacheTime = 0;
const SENTIMENT_CACHE_MS = 5 * 60 * 1000;

async function getSentimentCached() {
    if (!cachedSentiment || Date.now() - sentimentCacheTime > SENTIMENT_CACHE_MS) {
        cachedSentiment = await binance.getMarketSentiment().catch(() => ({
            totalBias: '0', overallSentiment: 'NEUTRAL', tradingBias: 'Neutral',
            fngEmoji: '⚪', fngValue: 'N/A', btcDominance: 'N/A', newsSentimentScore: 0,
        }));
        sentimentCacheTime = Date.now();
    }
    return cachedSentiment;
}

// ══════════════════════════════════════════════════════════════
//  TOP-DOWN SETUP SCANNER
//  v7: Daily Bias Master Filter applied before quality gate.
//  A signal that contradicts the daily bias is not a setup —
//  it's a noise trade with institutional headwind against it.
// ══════════════════════════════════════════════════════════════

/**
 * Score threshold for a HIGH-PROB SCALP to bypass the Daily Bias filter.
 * Rationale: A massive-score scalp (strong institutional 15m OB + 5m confirmation)
 * can occasionally be taken against the daily bias, but ONLY if every other
 * factor aligns and the score far exceeds the normal entry threshold.
 */
const BIAS_EXCEPTION_SCORE = 45;   // Only scalps scoring 45+/90 can bypass daily bias filter
const MIN_SCAN_SCORE       = 12;   // Minimum score to even consider a setup

async function getTopDownSetups() {
    const foundSetups = [];

    const coinsToScan = binance.isReady()
        ? binance.getWatchedCoins()
        : await binance.getTopTrendingCoins(20);

    for (const coin of coinsToScan) {
        try {
            const aData = await analyzer.run14FactorAnalysis(coin, '15m');

            if (aData.score < MIN_SCAN_SCORE) continue;

            const sent      = await getSentimentCached();
            const sentBias  = parseFloat(sent.totalBias) || 0;
            const sentBonus =
                (aData.direction === 'LONG'  && sentBias >= 1)  ?  1 :
                (aData.direction === 'SHORT' && sentBias <= -1) ?  1 :
                (aData.direction === 'LONG'  && sentBias <= -1) ? -1 :
                (aData.direction === 'SHORT' && sentBias >= 1)  ? -1 : 0;

            const adjustedScore = aData.score + sentBonus;

            // ════════════════════════════════════════════════════════
            //  v7: DAILY BIAS MASTER FILTER (Top-Down Analysis)
            //  ─────────────────────────────────────────────────────
            //  This is the most important filter in institutional trading.
            //  Trading WITH the daily bias = trading with institutional flow.
            //  Trading AGAINST it = fighting the dominant market participants.
            //
            //  Rules:
            //   • BULLISH daily → Only LONG setups pass (no counter-trend shorts)
            //   • BEARISH daily → Only SHORT setups pass (no counter-trend longs)
            //   • RANGING daily → Both directions allowed (no filter)
            //
            //  Exception: A HIGH-PROB SCALP (⚡) with score ≥ 45 can bypass.
            //  This allows rare, ultra-high-confidence scalps against the bias
            //  when the 4H + 1H + 15m + 5m OB structure is overwhelmingly clear.
            // ════════════════════════════════════════════════════════
            const dailyBias       = aData.dailyBias;
            const isHighProbScalp = aData.tradeCategory && aData.tradeCategory.label.includes('HIGH-PROB SCALP');
            const isExceptionCase = isHighProbScalp && adjustedScore >= BIAS_EXCEPTION_SCORE;

            if (dailyBias && dailyBias.bias !== 'RANGING') {
                if (dailyBias.bias === 'BULLISH' && aData.direction === 'SHORT') {
                    if (!isExceptionCase) continue;   // blocked — trading against daily bull
                }
                if (dailyBias.bias === 'BEARISH' && aData.direction === 'LONG') {
                    if (!isExceptionCase) continue;   // blocked — trading against daily bear
                }
            }

            // ── Confirmation Gate ─────────────────────────────────
            const confScore = aData.confScore || 0;
            const confGate  = aData.confGate  || false;

            const coreConf = [
                aData.choch && aData.choch.includes(aData.direction === 'LONG' ? 'Bullish' : 'Bearish'),
                aData.liquiditySweep && aData.liquiditySweep.includes(aData.direction === 'LONG' ? 'Bullish' : 'Bearish'),
                aData.choch5m && aData.choch5m.includes(aData.direction === 'LONG' ? 'Bullish' : 'Bearish'),
                aData.sweep5m && aData.sweep5m.includes(aData.direction === 'LONG' ? 'Bullish' : 'Bearish'),
            ].filter(Boolean).length;

            const qualityPass =
                adjustedScore >= 18 ? (confScore >= 1 || coreConf >= 1) :
                adjustedScore >= 12 ? (confGate || coreConf >= 2) : false;

            if (!qualityPass) continue;

            // ── Build Setup Object ────────────────────────────────
            foundSetups.push({
                coin:             coin.replace('USDT', ''),
                type:             aData.direction === 'LONG' ? 'LONG 🟢' : 'SHORT 🔴',
                rawScore:         adjustedScore,
                score:            `${adjustedScore}/${aData.maxScore}`,
                price:            aData.priceStr,
                tp1:              aData.tp1,
                tp2:              aData.tp2,
                tp3:              aData.tp3,
                tp:               aData.tp2,
                sl:               aData.sl,
                adx:              aData.adxData.value,
                reasons:          aData.reasons,
                liquiditySweep:   aData.liquiditySweep || 'None',
                choch:            aData.choch || 'None',
                choch5m:          aData.choch5m || 'None',
                sweep5m:          aData.sweep5m || 'None',
                sentEmoji:        sentBonus > 0 ? '📰✅' : sentBonus < 0 ? '📰⚠️' : '',
                tradeCategory:    aData.tradeCategory ? aData.tradeCategory.label : null,
                orderType:        aData.orderSuggestion ? aData.orderSuggestion.type : null,
                dailyTrend:       aData.dailyTrend || '',
                dailyAligned:     aData.dailyAligned,
                // v7 NEW fields
                dailyBias:        aData.dailyBias,       // full bias object
                regimeLabel:      aData.regimeLabel,     // 'TRENDING (ADX 28)' etc.
                goldenConfluence: aData.goldenConfluence, // true = ⭐ bonus active
                isExceptionCase,                          // true = bypassed daily filter
                bbSqueeze:        aData.bbSqueeze,
                volExpansion:     aData.volExpansion,
                mmTrap:           aData.mmTrap,
                tf3Align:         aData.tf3Align,
                coreConf,
                confScore,
                confGate,
            });

        } catch (_e) { /* skip failed coin */ }
    }

    foundSetups.sort((a, b) => b.rawScore - a.rawScore);
    return foundSetups.slice(0, 5);
}

// ─── Scanner / Trade Manager State ────────────────────────────
let _scannerActive   = false;
let activeTradeManager = null;
let _15mCloseHandler = null;
let _debounceTimer   = null;
let _connRef         = null;
let _ownerJidRef     = null;

// ══════════════════════════════════════════════════════════════
//  TRADE MANAGER (60-second price poll)
//  v7: Auto-close events save closeMetadata to MongoDB for
//  the upcoming AI Backtesting module.
// ══════════════════════════════════════════════════════════════
function startTradeManager(conn) {
    if (activeTradeManager) return;

    const FILL_TOLERANCE = 0.0025;

    activeTradeManager = setInterval(async () => {
        try {
            const activeTrades = await db.Trade.find({ status: { $in: ['active', 'pending'] } });
            if (!activeTrades || activeTrades.length === 0) return;
            const currentSettings = await db.getSettings();

            for (const trade of activeTrades) {
                try {
                    const res = await axios.get(
                        `https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`,
                        { timeout: 5000 }
                    );
                    const currentPrice = parseFloat(res.data.price);
                    const isLong  = trade.direction === 'LONG';
                    const isPaper = !!trade.isPaper;
                    const cb      = trade.coin.replace('USDT', '');
                    const de      = isLong ? '🟢' : '🔴';
                    const dir     = trade.direction;

                    // ── PENDING → ACTIVE ──────────────────────────────
                    if (trade.status === 'pending') {
                        const fillZoneHit = isLong
                            ? currentPrice <= trade.entry * (1 + FILL_TOLERANCE)
                            : currentPrice >= trade.entry * (1 - FILL_TOLERANCE);

                        if (fillZoneHit) {
                            trade.status    = 'active';
                            trade.fillPrice = currentPrice;
                            await trade.save();

                            if (isPaper) {
                                await conn.sendMessage(trade.userJid, { text:
                                    `🤖 *PAPER LIMIT ORDER FILLED!* ✅\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `📋 Order Type:  ⏳ LIMIT → ✅ FILLED\n` +
                                    `📍 Set Entry:   $${parseFloat(trade.entry).toFixed(4)}\n` +
                                    `💹 Fill Price:  $${currentPrice.toFixed(4)}\n\n` +
                                    `🎯 TP1: $${parseFloat(trade.tp1 || trade.tp).toFixed(4)}\n` +
                                    `🎯 TP2: $${parseFloat(trade.tp2 || trade.tp).toFixed(4)}\n` +
                                    `🛡️ SL:  $${parseFloat(trade.sl).toFixed(4)}\n\n` +
                                    `📊 *.myptrades* ගසා Live P&L බලන්න`,
                                });
                            } else {
                                await conn.sendMessage(trade.userJid, { text:
                                    `🔔 *LIMIT ORDER ENTRY ZONE!*\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `📋 Order Type: ⏳ LIMIT\n` +
                                    `📍 Entry Zone: $${parseFloat(trade.entry).toFixed(4)}\n` +
                                    `💹 Current:    $${currentPrice.toFixed(4)}\n\n` +
                                    `✅ *Exchange හිදී Order Fill Confirm කරන්න!*\n\n` +
                                    `🎯 TP1: $${parseFloat(trade.tp1 || trade.tp).toFixed(4)}\n` +
                                    `🎯 TP2: $${parseFloat(trade.tp2 || trade.tp).toFixed(4)}\n` +
                                    `🛡️ SL:  $${parseFloat(trade.sl).toFixed(4)}`,
                                });
                            }
                        }
                        continue;
                    }

                    // ── STALE TRADE WARNING (48h) ─────────────────────
                    if (!trade.tp1Hit && trade.status === 'active') {
                        const hoursOpen = (Date.now() - new Date(trade.openTime)) / 3600000;
                        if (hoursOpen >= 48 && !trade._staleWarned) {
                            trade._staleWarned = true;
                            await conn.sendMessage(trade.userJid, { text:
                                `⏰ *STALE TRADE WARNING!*\n━━━━━━━━━━━━━━━━\n` +
                                `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                `⏱️ *${hoursOpen.toFixed(0)} hours open* — TP1 not hit yet.\n\n` +
                                `📍 Entry: $${parseFloat(trade.entry).toFixed(4)}\n` +
                                `💹 Current: $${currentPrice.toFixed(4)}\n` +
                                `🎯 TP1: $${parseFloat(trade.tp1||trade.tp).toFixed(4)}\n\n` +
                                `*Options:*\n` +
                                `• Wait — setup still valid\n` +
                                `• *.${isPaper ? 'closepaper' : 'closetrade'} ${cb}* — exit manually\n` +
                                `⚠️ _Capital tied up for 2+ days without progress_`,
                            });
                        }
                    }

                    // ── TP1 HIT ───────────────────────────────────────
                    if (trade.tp1 && !trade.tp1Hit) {
                        const tp1v   = parseFloat(trade.tp1);
                        const tp1Hit = isLong ? currentPrice >= tp1v : currentPrice <= tp1v;
                        if (tp1Hit) {
                            trade.tp1Hit = true;
                            if (isPaper) {
                                const pQty = (trade.quantity || 0) * 0.33;
                                const pPnl = Math.abs(tp1v - trade.entry) * pQty;
                                await db.updatePaperBalance(trade.userJid, pPnl, pPnl > 0, false);
                                trade.sl = trade.entry;
                                await trade.save();
                                await conn.sendMessage(trade.userJid, { text:
                                    `🎯 *PAPER TP1 HIT!* 💰\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `✅ TP1: $${tp1v.toFixed(4)} Hit!\n` +
                                    `💰 +33% Profit: +$${pPnl.toFixed(2)} ✅ Auto-booked\n` +
                                    `🛡️ SL → Entry (Break-even) ✅ Auto-moved\n\n` +
                                    `🎯 TP2: $${parseFloat(trade.tp2 || trade.tp).toFixed(4)} targeting...`,
                                });
                            } else {
                                await trade.save();
                                const est = trade.quantity
                                    ? `~$${(Math.abs(tp1v - trade.entry) * trade.quantity * 0.33).toFixed(2)}`
                                    : '?';
                                await conn.sendMessage(trade.userJid, { text:
                                    `🎯 *TP1 HIT!* 💰\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `✅ TP1: $${tp1v.toFixed(4)} Hit! (Est. ${est})\n\n` +
                                    `*Exchange හිදී කරන්න:*\n` +
                                    `• Position ෙන් 33% Close කරන්න\n` +
                                    `• SL → Entry ($${parseFloat(trade.entry).toFixed(4)}) Move කරන්න\n` +
                                    `• TP2: $${parseFloat(trade.tp2 || trade.tp).toFixed(4)} target`,
                                });
                            }
                        }
                    }

                    // ── TP2 HIT ───────────────────────────────────────
                    if (trade.tp1Hit && !trade.tp2Hit && trade.tp2) {
                        const tp2v   = parseFloat(trade.tp2);
                        const tp2Hit = isLong ? currentPrice >= tp2v : currentPrice <= tp2v;
                        if (tp2Hit) {
                            trade.tp2Hit = true;
                            await trade.save();
                            if (isPaper) {
                                const pQty = (trade.quantity || 0) * 0.33;
                                const pPnl = Math.abs(tp2v - trade.entry) * pQty;
                                await db.updatePaperBalance(trade.userJid, pPnl, false, false);
                                await conn.sendMessage(trade.userJid, { text:
                                    `🎯 *PAPER TP2 HIT!* 🔥\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `🔥 TP2: $${tp2v.toFixed(4)} Hit!\n` +
                                    `💰 +33% Profit: +$${pPnl.toFixed(2)} ✅ Auto-booked\n\n` +
                                    `🎯 Remaining 34% → TP3: $${parseFloat(trade.tp).toFixed(4)}`,
                                });
                            } else {
                                await conn.sendMessage(trade.userJid, { text:
                                    `🎯 *TP2 HIT!* 🔥\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `🔥 TP2: $${tp2v.toFixed(4)} Hit!\n\n` +
                                    `*Exchange හිදී කරන්න:*\n` +
                                    `• Position ෙන් 33% Close කරන්න\n` +
                                    `• TP3: $${parseFloat(trade.tp).toFixed(4)} target hold`,
                                });
                            }
                        }
                    }

                    // ── DCA ZONE ──────────────────────────────────────
                    if (trade.dcaLevel === 0) {
                        const risk    = Math.abs(trade.entry - trade.sl);
                        const dcaZone = isLong
                            ? trade.entry - risk * 0.7
                            : trade.entry + risk * 0.7;
                        const atDca = isLong
                            ? (currentPrice <= dcaZone && currentPrice > trade.sl)
                            : (currentPrice >= dcaZone && currentPrice < trade.sl);
                        if (atDca) {
                            trade.dcaLevel = 1;
                            await trade.save();
                            const avg = ((trade.entry + currentPrice) / 2).toFixed(4);
                            await conn.sendMessage(trade.userJid, { text:
                                `⚠️ *DCA ZONE!* 📉\n━━━━━━━━━━━━━━━━\n` +
                                `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                `📍 Entry: $${parseFloat(trade.entry).toFixed(4)}\n` +
                                `📉 DCA Price: $${currentPrice.toFixed(4)}\n` +
                                `📊 Avg (if DCA): $${avg}\n\n` +
                                (isPaper
                                    ? `• *.paper* reply කරලා 2nd position open කරන්න\n• SL: $${parseFloat(trade.sl).toFixed(4)} (unchanged)`
                                    : `• Exchange ෙල් same margin DCA order දාන්න\n• SL: $${parseFloat(trade.sl).toFixed(4)} (unchanged)`) +
                                `\n\n⚠️ _SL zone ළඟා නොවූ විට DCA කරන්න!_`,
                            });
                        }
                    }

                    // ── TRAILING SL ───────────────────────────────────
                    if (currentSettings.trailingSl && !trade.tp1Hit) {
                        const risk     = Math.abs(trade.entry - trade.sl);
                        const beTarget = isLong ? trade.entry + risk : trade.entry - risk;
                        let trail = false;
                        if (isLong  && currentPrice >= beTarget && parseFloat(trade.sl) < trade.entry) { trade.sl = trade.entry; trail = true; }
                        if (!isLong && currentPrice <= beTarget && parseFloat(trade.sl) > trade.entry) { trade.sl = trade.entry; trail = true; }
                        if (trail) {
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text:
                                `🛡️ *SL → BREAK-EVEN!*\n━━━━━━━━━━━━━━━━\n` +
                                `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                `Stop Loss → Entry $${parseFloat(trade.entry).toFixed(4)}\n` +
                                (isPaper ? `✅ Auto-updated` : `✅ Exchange හිදී SL update කරන්න!`) +
                                `\n_Trade 100% Risk-Free!_ 🎉`,
                            });
                        }
                    }

                    // ── TP3 / SL HIT → CLOSE ─────────────────────────
                    let hitType = null, result = '';
                    const tp3v = parseFloat(trade.tp), slv = parseFloat(trade.sl);
                    if (isLong) {
                        if (currentPrice >= tp3v)     { hitType = 'TP3'; result = 'WIN'; }
                        else if (currentPrice <= slv) { hitType = 'SL';  result = slv === parseFloat(trade.entry) ? 'BREAK-EVEN' : 'LOSS'; }
                    } else {
                        if (currentPrice <= tp3v)     { hitType = 'TP3'; result = 'WIN'; }
                        else if (currentPrice >= slv) { hitType = 'SL';  result = slv === parseFloat(trade.entry) ? 'BREAK-EVEN' : 'LOSS'; }
                    }

                    if (hitType) {
                        const emoji = result === 'WIN' ? '🏆' : result === 'BREAK-EVEN' ? '🛡️' : '💀';

                        if (isPaper) {
                            const remFactor = trade.tp1Hit && trade.tp2Hit ? 0.34 : trade.tp1Hit ? 0.67 : 1.0;
                            const closeQty  = (trade.quantity || 0) * remFactor;
                            const priceDiff = isLong ? currentPrice - trade.entry : trade.entry - currentPrice;
                            const profit    = priceDiff * closeQty;
                            const pnlPct    = trade.marginUsed > 0 ? (profit / trade.marginUsed * 100) : 0;
                            await db.closeTrade(trade._id, result, pnlPct, profit);
                            await db.updatePaperBalance(trade.userJid, profit, result === 'WIN', result === 'BREAK-EVEN');

                            // ── v7: Save close metadata for AI Backtesting module ──
                            // We do this AFTER db.closeTrade so the document is updated
                            // but closeMetadata fields are added additionally.
                            try {
                                await db.Trade.findByIdAndUpdate(trade._id, {
                                    $set: {
                                        closeType:       hitType,
                                        closePrice:      currentPrice,
                                        closeTime:       new Date(),
                                        closeMethod:     'AUTO',   // AUTO = bot managed, MANUAL = user command
                                        // Backtesting fields (dailyBias/tradeCategory/reasons saved at open time)
                                    }
                                });
                            } catch (_metaErr) { /* non-critical — don't interrupt trade close */ }

                            const user = await db.getUser(trade.userJid);
                            await conn.sendMessage(trade.userJid, { text:
                                `${emoji} *PAPER TRADE CLOSED!* ${hitType === 'TP3' ? '🎯' : '⛔'}\n━━━━━━━━━━━━━━━━\n` +
                                `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                `*${result}* — ${hitType} @ $${currentPrice.toFixed(4)}\n` +
                                `📍 Entry: $${parseFloat(trade.entry).toFixed(4)}\n` +
                                `📋 Order: ${trade.orderType === 'LIMIT' ? '⏳ LIMIT (Filled)' : '⚡ MARKET'}\n\n` +
                                `💰 *PnL: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)*\n` +
                                `💼 Balance: $${(user.paperBalance || 0).toFixed(2)}\n\n` +
                                `📜 *.paperhistory* | 📊 *.margin*`,
                            });
                        } else {
                            // ── v7: Save close metadata for real tracked trades ──
                            try {
                                await db.Trade.findByIdAndUpdate(trade._id, {
                                    $set: {
                                        closeType:   hitType,
                                        closePrice:  currentPrice,
                                        closeTime:   new Date(),
                                        closeMethod: 'AUTO',
                                    }
                                });
                            } catch (_metaErr) { /* non-critical */ }

                            const action = hitType === 'TP3'
                                ? `• Position සම්පූර්ණයෙන් Close කරන්න\n• Profit Withdraw/Reinvest decide කරන්න`
                                : `• Position Close කරන්න\n• Loss accept කරලා next setup බලන්න`;
                            await db.closeTrade(trade._id, result, 0, 0);
                            await conn.sendMessage(trade.userJid, { text:
                                `${emoji} *${hitType} HIT!* ${hitType === 'TP3' ? '🎉' : '⛔'}\n━━━━━━━━━━━━━━━━\n` +
                                `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                `*${result}* — ${hitType} @ $${currentPrice.toFixed(4)}\n` +
                                `📍 Entry was: $${parseFloat(trade.entry).toFixed(4)}\n\n` +
                                `*Exchange හිදී කරන්න:*\n` + action + `\n\n` +
                                `_✅ Bot tracking ෙන් auto-removed_`,
                            });
                        }
                    }

                } catch (_e) { /* skip failed individual trade */ }
            }
        } catch (_e) { /* top-level guard */ }
    }, 60000);
}

// ─── Signal Scanner (Event-Driven) ────────────────────────────

function scheduleDebounced() {
    if (_debounceTimer) return;
    _debounceTimer = setTimeout(async () => {
        _debounceTimer = null;
        await runSignalScan();
    }, 15000);
}

async function runSignalScan() {
    if (!_connRef || !_ownerJidRef) return;

    try {
        const setups = await getTopDownSetups();
        if (!setups || setups.length === 0) return;

        const sent = await getSentimentCached();

        // ── Determine overall daily bias for the market ──────────
        // Use the most common bias across found setups for header display.
        const biasVotes = { BULLISH: 0, BEARISH: 0, RANGING: 0 };
        setups.forEach(s => {
            if (s.dailyBias) biasVotes[s.dailyBias.bias] = (biasVotes[s.dailyBias.bias] || 0) + 1;
        });
        const dominantBias = Object.entries(biasVotes).sort((a, b) => b[1] - a[1])[0];
        const biasHeader   = dominantBias
            ? `📅 Daily Bias Filter: *${dominantBias[0]}* ${dominantBias[0] === 'BULLISH' ? '🟢' : dominantBias[0] === 'BEARISH' ? '🔴' : '⚪'} (Only ${dominantBias[0] === 'BULLISH' ? 'LONGs' : dominantBias[0] === 'BEARISH' ? 'SHORTs' : 'All'} passed)\n`
            : '';

        let msg = `🚀 *14-FACTOR AUTO SIGNAL ALERT* 🚀\n_Top ${setups.length} Best Setups Now_\n\n`;
        msg += `🧠 *Market:* ${sent.overallSentiment} | ${sent.fngEmoji} F&G: ${sent.fngValue}\n`;
        msg += biasHeader + `\n`;

        setups.forEach((s, i) => {
            const catTag    = s.tradeCategory ? `\n   📅 ${s.tradeCategory}` : '';
            const orderTag  = s.orderType
                ? (s.orderType.includes('LIMIT') ? ' ⏳ LIMIT' : ' ⚡ MARKET')
                : '';
            const dayTag    = s.dailyBias ? ` | Daily: ${s.dailyBias.label}` : '';
            const trapTag   = s.mmTrap && (s.mmTrap.bullTrap || s.mmTrap.bearTrap) ? ` 🪤` : '';
            const sqzTag    = s.bbSqueeze && s.bbSqueeze.exploding ? ` 💥` : '';
            const goldTag   = s.goldenConfluence ? ` ⭐` : '';
            const biasWarn  = s.isExceptionCase ? ` ⚠️_Counter-bias scalp_` : '';
            msg +=
                `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐) ${s.sentEmoji || ''}${orderTag}${trapTag}${sqzTag}${goldTag}${catTag}\n` +
                `   📍 $${s.price} | ADX: ${s.adx}${dayTag}${biasWarn}\n` +
                `   ✔️ ${s.reasons}\n` +
                `   🤖 .future ${s.coin} 15m\n\n`;
        });
        msg += `_⏱️ Next scan on 15m candle close | .set 1 off ගසා Stop කරන්න_`;

        await _connRef.sendMessage(_ownerJidRef, { text: msg.trim() });
    } catch (_e) { /* silent — keep listener alive */ }
}

function startSignalScanner(conn, ownerJid) {
    if (_scannerActive) return;
    _connRef       = conn;
    _ownerJidRef   = ownerJid;
    _scannerActive = true;
    _15mCloseHandler = () => scheduleDebounced();
    binance.wsEvents.on('15m_candle_close', _15mCloseHandler);
    console.log('[Scanner] ✅ Event-driven signal scanner started (listening for 15m closes).');
    if (binance.isReady()) { runSignalScan().catch(() => {}); }
}

function stopSignalScanner() {
    if (!_scannerActive) return;
    if (_15mCloseHandler) {
        binance.wsEvents.off('15m_candle_close', _15mCloseHandler);
        _15mCloseHandler = null;
    }
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    _scannerActive = false;
    console.log('[Scanner] 🔴 Signal scanner stopped.');
}

// ─── Funding Rate Extreme Alert (.fundingalert) ───────────────
cmd({
    pattern: 'fundingalert', alias: ['funding', 'squeeze', 'fundrates'],
    desc: 'Extreme funding rate scanner — find squeeze setups',
    category: 'crypto', react: '💸', filename: __filename,
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');
        const axios = require('axios');
        const res = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 8000 });
        const data = res.data;
        if (!data || !data.length) return await reply('❌ Funding data ලබාගැනීමට නොහැකිය.');

        const coins = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','AVAXUSDT',
                       'DOTUSDT','LINKUSDT','MATICUSDT','ATOMUSDT','NEARUSDT','LTCUSDT','DOGEUSDT','UNIUSDT'];

        const extremes = [], mildLong = [], mildShort = [];
        coins.forEach(coin => {
            const d = data.find(x => x.symbol === coin);
            if (!d) return;
            const rate = parseFloat(d.lastFundingRate) * 100;
            const name = coin.replace('USDT','');
            if (rate > 0.1)        extremes.push({ name, rate, dir: 'SHORT', label: `🔴 Longs overloaded → SHORT squeeze!` });
            else if (rate < -0.1)  extremes.push({ name, rate, dir: 'LONG',  label: `🟢 Shorts overloaded → LONG squeeze!` });
            else if (rate > 0.05)  mildLong.push({ name, rate });
            else if (rate < -0.05) mildShort.push({ name, rate });
        });
        extremes.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));

        let msg = `💸 *FUNDING RATE EXTREME SCANNER*\n━━━━━━━━━━━━━━━━━━\n\n`;
        if (extremes.length === 0) {
            msg += `⚪ *No extreme funding rates right now.*\nAll rates within normal range (-0.1% ~ +0.1%).\n\n`;
        } else {
            msg += `🚨 *EXTREME RATES (>0.1%) — Squeeze Risk!*\n`;
            extremes.forEach(e => {
                const sign = e.rate > 0 ? '+' : '';
                msg += `\n💀 *#${e.name}* — ${sign}${e.rate.toFixed(4)}%\n`;
                msg += `   ${e.label}\n`;
                msg += `   🤖 *.future ${e.name}* (look for ${e.dir} setup)\n`;
            });
            msg += '\n';
        }
        if (mildLong.length || mildShort.length) {
            msg += `━━━━━━━━━━━━━━━━━━\n⚠️ *Elevated Rates (Watch)*\n`;
            mildLong.forEach(e  => msg += `🔴 #${e.name}: +${e.rate.toFixed(4)}% (Longs paying)\n`);
            mildShort.forEach(e => msg += `🟢 #${e.name}: ${e.rate.toFixed(4)}% (Shorts paying)\n`);
        }
        msg += `\n━━━━━━━━━━━━━━━━━━\n💡 *Funding Rate Guide:*\n`;
        msg += `> +0.1%+ = Longs crowded → Short squeeze imminent\n`;
        msg += `< -0.1% = Shorts crowded → Long squeeze imminent\n`;
        msg += `0.01% neutral zone = balanced market\n\n`;
        msg += `_ℹ️ Every 8h funds transfer. Next: check .news for sentiment_`;

        await reply(msg.trim());
        await m.react('✅');
    } catch(e) { await reply('❌ Error: ' + e.message); }
});

// ─── Manual Scan Command (.scan) ──────────────────────────────
cmd({
    pattern:  'scan',
    alias:    ['superscan', 'scanner'],
    desc:     'Manual Market Scan - Top 5 Best Setups',
    category: 'crypto',
    react:    '🔍',
    filename: __filename,
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');

        const wsStatus = binance.isReady()
            ? '🟢 *WebSocket:* LIVE (Zero-Latency Cache Active)'
            : '🟡 *WebSocket:* Initialising...';
        const scanStatus = _scannerActive
            ? '🟢 *Auto Scanner:* ON (.set 1 off ගසා Stop)'
            : '🔴 *Auto Scanner:* OFF (.set 1 on ගසා Start)';

        await reply(
            `🔍 *MANUAL SCAN ක්‍රියාත්මක වේ...*\n${wsStatus}\n${scanStatus}\n\n` +
            `📅 *Daily Bias Filter:* ACTIVE — Only setups aligned with Daily Bias pass.\n` +
            `Top ${binance.isReady() ? binance.getWatchedCoins().length : 20} Coins Scan වෙමින් පවතී... ⏳\n` +
            `_(No REST polling — reads from live WS cache)_`
        );

        const setups = await getTopDownSetups();

        if (setups.length === 0) {
            return await reply(
                `╔═══════════════════════════╗\n║  🔍 *MANUAL SCAN RESULTS*  ║\n╚═══════════════════════════╝\n\n` +
                `Score 12/90 ට වඩා & Daily Bias filter pass කළ Setups දැනට නොමැත. ⚪\n\n` +
                `_Daily Bias filter active — counter-trend signals filtered out._\n` +
                `_Ranging market / bias shift නොමැති විට setups දිස් වේ._\n\n` +
                `කිසිවේලාවකට පසු නැවත .scan ගසන්න.\n\n${scanStatus}`
            );
        }

        const sent = await getSentimentCached();

        // ── Gather bias summary across setups ────────────────────
        const biasSet = [...new Set(setups.filter(s => s.dailyBias).map(s => s.dailyBias.label))];
        const biasLine = biasSet.length ? `📅 *Daily Bias Filter Active:* ${biasSet.join(' | ')}\n` : '';

        let outMsg = `╔═══════════════════════════╗\n║  🎯 *TOP 5 SNIPER SETUPS*  ║\n╚═══════════════════════════╝\n\n`;
        outMsg += `🧠 *Market Sentiment:* ${sent.overallSentiment}\n`;
        outMsg += `${sent.fngEmoji} F&G: ${sent.fngValue} | ₿ BTC.D: ${sent.btcDominance}% | 📰 ${sent.newsSentimentScore > 0 ? '+' : ''}${sent.newsSentimentScore}\n`;
        outMsg += biasLine + `\n`;

        setups.forEach((s, i) => {
            const mSweep   = s.liquiditySweep !== 'None'       ? `\n   💧 ${s.liquiditySweep}` : '';
            const mChoch   = s.choch !== 'None'                ? `\n   🔄 ${s.choch}` : '';
            const mChoch5m = s.choch5m && s.choch5m !== 'None' ? `\n   ⚡ 5m: ${s.choch5m}` : '';
            const catLine  = s.tradeCategory                   ? `\n   📅 ${s.tradeCategory}` : '';
            const orderTag = s.orderType
                ? (s.orderType.includes('LIMIT') ? '\n   📋 ⏳ LIMIT ORDER' : '\n   📋 ⚡ MARKET ORDER')
                : '';
            const dayTag   = s.dailyBias
                ? `\n   📅 Daily: ${s.dailyBias.label} ${s.dailyAligned ? '✅' : '⚠️'}`
                : (s.dailyTrend ? `\n   📅 Daily: ${s.dailyTrend} ${s.dailyAligned ? '✅' : '⚠️'}` : '');
            const regTag   = s.regimeLabel ? `\n   📊 Regime: ${s.regimeLabel}` : '';
            const goldTag  = s.goldenConfluence ? `\n   ⭐ GOLDEN CONFLUENCE (SMC + Retail Both Confirmed!)` : '';
            const trapTag  = s.mmTrap && (s.mmTrap.bullTrap || s.mmTrap.bearTrap)
                ? `\n   🪤 ${s.mmTrap.display}` : '';
            const sqzTag   = s.bbSqueeze && (s.bbSqueeze.exploding || s.bbSqueeze.isSqueezing)
                ? `\n   ${s.bbSqueeze.exploding ? '💥' : '⚡'} ${s.bbSqueeze.display}` : '';
            const tfTag    = s.tf3Align && s.tf3Align.aligned
                ? `\n   ✅ ${s.tf3Align.display}` : '';
            const confTag  = `\n   🔒 Confirmations: ${s.confScore || s.coreConf}/${s.confScore ? '14' : '4'} ${s.confGate ? '✅' : ''}`;
            const biasExc  = s.isExceptionCase ? `\n   ⚠️ _Counter-bias scalp (score override)_` : '';
            const wyckTag  = s.reasons && s.reasons.includes('Wyckoff') ? `\n   🌊 ${s.reasons.split(',').find(r=>r.includes('Wyckoff'))?.trim()}` : '';
            const ichiTag  = s.reasons && s.reasons.includes('Ichimoku') ? `\n   ☁️ ${s.reasons.split(',').find(r=>r.includes('Ichimoku'))?.trim()}` : '';

            outMsg +=
                `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐) ${s.sentEmoji || ''}\n` +
                `   📍 Price: $${s.price} | 🔥 ADX: ${s.adx}\n` +
                `   🎯 TP1: $${s.tp1} | TP2: $${s.tp2} | SL: $${s.sl}\n` +
                `   ✔️ ${s.reasons}${mSweep}${mChoch}${mChoch5m}${dayTag}${regTag}${goldTag}${trapTag}${sqzTag}${tfTag}${wyckTag}${ichiTag}${catLine}${orderTag}${confTag}${biasExc}\n` +
                `   🤖 *.future ${s.coin} 15m*\n\n`;
        });
        outMsg += `${wsStatus}\n${scanStatus}`;

        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── Exports ───────────────────────────────────────────────────
function getScannerStatus() { return _scannerActive; }

async function startScannerFromSettings(conn, ownerJid) {
    if (_scannerActive) return false;
    await binance.initWebSocketStreams(30);
    startTradeManager(conn);
    startSignalScanner(conn, ownerJid);
    return true;
}

function stopScannerFromSettings() {
    if (!_scannerActive && !activeTradeManager) return false;
    stopSignalScanner();
    if (activeTradeManager) { clearInterval(activeTradeManager); activeTradeManager = null; }
    return true;
}

function autoStartTradeManager(conn) {
    startTradeManager(conn);
}

module.exports = { getScannerStatus, startScannerFromSettings, stopScannerFromSettings, autoStartTradeManager };
