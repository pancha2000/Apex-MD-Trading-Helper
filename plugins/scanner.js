/**
 * ═══════════════════════════════════════════════════════════════
 *  APEX-MD  ·  scanner.js  ·  Event-Driven WebSocket Edition
 *  ─────────────────────────────────────────────────────────────
 *  • NO setInterval for signal scanning — 100% event-driven
 *  • Listens to binance.wsEvents '15m_candle_close' events
 *  • 15-second debounce batches multiple simultaneous closes
 *    into a single scan pass (all 30 coins close at the same time)
 *  • Trade Manager keeps its 60-second price-poll (one REST call
 *    per active trade per minute — minimal overhead)
 *  • WebSocket init called automatically when scanner starts
 *
 *  ✅ TRADE MANAGER FIX: Pending → Active fill logic now uses a
 *     0.25% tolerance buffer so LIMIT orders fill when price
 *     enters the entry *zone*, not only at an exact tick match.
 *     Correct directional logic:
 *       LONG pending  → fills when currentPrice ≤ entry × 1.0025
 *       SHORT pending → fills when currentPrice ≥ entry × 0.9975
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
const SENTIMENT_CACHE_MS = 5 * 60 * 1000;   // refresh every 5 min

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

// ─── Top 5 Setups Scanner ─────────────────────────────────────
/**
 * Scans all watched coins (already in WS cache) for high-probability
 * setups using the 14-Factor analyzer.
 * No REST calls are made here — everything reads from the in-memory cache.
 */
async function getTopDownSetups() {
    const foundSetups = [];

    const coinsToScan = binance.isReady()
        ? binance.getWatchedCoins()
        : await binance.getTopTrendingCoins(20);

    for (const coin of coinsToScan) {
        try {
            const aData = await analyzer.run14FactorAnalysis(coin, '15m');

            if (aData.score >= 9) {
                const sent     = await getSentimentCached();
                const sentBias = parseFloat(sent.totalBias) || 0;
                const sentBonus =
                    (aData.direction === 'LONG'  && sentBias >= 1)  ?  1 :
                    (aData.direction === 'SHORT' && sentBias <= -1) ?  1 :
                    (aData.direction === 'LONG'  && sentBias <= -1) ? -1 :
                    (aData.direction === 'SHORT' && sentBias >= 1)  ? -1 : 0;

                const adjustedScore = aData.score + sentBonus;

                foundSetups.push({
                    coin:           coin.replace('USDT', ''),
                    type:           aData.direction === 'LONG' ? 'LONG 🟢' : 'SHORT 🔴',
                    rawScore:       adjustedScore,
                    score:          `${adjustedScore}/${aData.maxScore}`,
                    price:          aData.priceStr,
                    tp1:            aData.tp1,
                    tp:             aData.tp2,
                    sl:             aData.sl,
                    adx:            aData.adxData.value,
                    reasons:        aData.reasons,
                    liquiditySweep: aData.liquiditySweep || 'None',
                    choch:          aData.choch || 'None',
                    sentEmoji:      sentBonus > 0 ? '📰✅' : sentBonus < 0 ? '📰⚠️' : '',
                    // MTF trade category (from Sniper edition)
                    tradeCategory:  aData.tradeCategory ? aData.tradeCategory.label : null,
                    orderType:      aData.orderSuggestion ? aData.orderSuggestion.type : null,
                });
            }
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

// ─── Trade Manager (60-second price poll) ─────────────────────
/**
 * Checks every 60 seconds:
 *   PENDING trades → activate when price enters the entry zone
 *   ACTIVE trades  → check TP1, TP2, TP3, SL, DCA, trailing SL
 *
 * ✅ FIX: Fill tolerance of 0.25% added to PENDING → ACTIVE transition.
 *    Real exchange limit orders fill inside a zone, not only at a single tick.
 *    Without tolerance, a LONG order at $100.00 would never fill if the lowest
 *    live price polled is $100.02 — now it fills at $100.25 or below.
 *
 *    LONG  pending fills: currentPrice ≤ entry × (1 + FILL_TOLERANCE)
 *    SHORT pending fills: currentPrice ≥ entry × (1 - FILL_TOLERANCE)
 */
function startTradeManager(conn) {
    if (activeTradeManager) return;

    // Fill zone tolerance: 0.25%
    // Meaning: a LONG order at $100 will fill if price reaches $100.25 or lower.
    // This mirrors how exchange limit orders fill inside a price band.
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

                    // ═══════════════════════════════════════════════════════
                    // PENDING → ACTIVE (LIMIT ORDER FILL)
                    // ═══════════════════════════════════════════════════════
                    //
                    // Logic:
                    //   LONG  limit: we placed a buy order BELOW current price.
                    //                It fills when price DROPS to or below entry.
                    //                Fill zone: currentPrice ≤ entry × (1 + FILL_TOLERANCE)
                    //                (0.25% tolerance: fills if price is within 0.25% above entry)
                    //
                    //   SHORT limit: we placed a sell order ABOVE current price.
                    //                It fills when price RISES to or above entry.
                    //                Fill zone: currentPrice ≥ entry × (1 - FILL_TOLERANCE)
                    //                (0.25% tolerance: fills if price is within 0.25% below entry)
                    //
                    if (trade.status === 'pending') {
                        const fillZoneHit = isLong
                            ? currentPrice <= trade.entry * (1 + FILL_TOLERANCE)
                            : currentPrice >= trade.entry * (1 - FILL_TOLERANCE);

                        if (fillZoneHit) {
                            // Activate the trade — record actual fill price
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
                        // Skip TP/SL checks — trade is not yet active
                        continue;
                    }

                    // ── TP1 HIT ─────────────────────────────────────────
                    if (trade.tp1 && !trade.tp1Hit) {
                        const tp1v   = parseFloat(trade.tp1);
                        const tp1Hit = isLong ? currentPrice >= tp1v : currentPrice <= tp1v;
                        if (tp1Hit) {
                            trade.tp1Hit = true;
                            if (isPaper) {
                                const pQty = (trade.quantity || 0) * 0.33;
                                const pPnl = Math.abs(tp1v - trade.entry) * pQty;
                                await db.updatePaperBalance(trade.userJid, pPnl, false, false);
                                trade.sl = trade.entry;   // move SL to break-even
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

                    // ── TP2 HIT ─────────────────────────────────────────
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

                    // ── DCA ZONE ─────────────────────────────────────────
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

                    // ── TRAILING SL (Break-even) ──────────────────────────
                    if (currentSettings.trailingSl && !trade.tp1Hit) {
                        const risk     = Math.abs(trade.entry - trade.sl);
                        const beTarget = isLong
                            ? trade.entry + risk
                            : trade.entry - risk;
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

                    // ── TP3 / SL HIT → CLOSE ─────────────────────────────
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

/**
 * Debounced scan runner.
 * Called when a 15m candle closes. Multiple coins close at the same
 * wall-clock second, so we collect all close events for 15 seconds
 * before running a single scan pass.
 */
function scheduleDebounced() {
    if (_debounceTimer) return;   // already waiting
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

        const sent  = await getSentimentCached();
        let msg = `🚀 *14-FACTOR AUTO SIGNAL ALERT* 🚀\n_Top ${setups.length} Best Setups Now_\n\n`;
        msg += `🧠 *Market:* ${sent.overallSentiment} | ${sent.fngEmoji} F&G: ${sent.fngValue}\n\n`;

        setups.forEach((s, i) => {
            const catTag   = s.tradeCategory ? `\n   📅 ${s.tradeCategory}` : '';
            const orderTag = s.orderType
                ? (s.orderType.includes('LIMIT') ? ' ⏳ LIMIT' : ' ⚡ MARKET')
                : '';
            msg +=
                `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐) ${s.sentEmoji || ''}${orderTag}${catTag}\n` +
                `   📍 $${s.price} | ADX: ${s.adx}\n` +
                `   ✔️ ${s.reasons}\n` +
                `   🤖 .future ${s.coin} 15m\n\n`;
        });
        msg += `_⏱️ Next scan on 15m candle close | .set 1 off ගසා Stop කරන්න_`;

        await _connRef.sendMessage(_ownerJidRef, { text: msg.trim() });
    } catch (_e) { /* silent — keep the listener alive */ }
}

/**
 * Attach the 15m candle-close listener to binance.wsEvents.
 * Each time ANY watched coin closes its 15m bar the debounce fires.
 */
function startSignalScanner(conn, ownerJid) {
    if (_scannerActive) return;

    _connRef       = conn;
    _ownerJidRef   = ownerJid;
    _scannerActive = true;

    _15mCloseHandler = () => scheduleDebounced();
    binance.wsEvents.on('15m_candle_close', _15mCloseHandler);

    console.log('[Scanner] ✅ Event-driven signal scanner started (listening for 15m closes).');

    if (binance.isReady()) {
        runSignalScan().catch(() => {});
    }
}

function stopSignalScanner() {
    if (!_scannerActive) return;
    if (_15mCloseHandler) {
        binance.wsEvents.off('15m_candle_close', _15mCloseHandler);
        _15mCloseHandler = null;
    }
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    _scannerActive = false;
    console.log('[Scanner] 🔴 Signal scanner stopped.');
}

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
            `Top ${binance.isReady() ? binance.getWatchedCoins().length : 20} Coins Scan වෙමින් පවතී... ⏳\n` +
            `_(No REST polling — reads from live WS cache)_`
        );

        const setups = await getTopDownSetups();

        if (setups.length === 0) {
            return await reply(
                `╔═══════════════════════════╗\n║  🔍 *MANUAL SCAN RESULTS*  ║\n╚═══════════════════════════╝\n\n` +
                `Score 9/${55} ට වඩා ලබාගත් Setups දැනට නොමැත. ⚪\n\nකිසිවේලාවකට පසු නැවත .scan ගසන්න.\n\n${scanStatus}`
            );
        }

        const sent = await getSentimentCached();
        let outMsg = `╔═══════════════════════════╗\n║  🎯 *TOP 5 SNIPER SETUPS*  ║\n╚═══════════════════════════╝\n\n`;
        outMsg += `🧠 *Market Sentiment:* ${sent.overallSentiment}\n`;
        outMsg += `${sent.fngEmoji} F&G: ${sent.fngValue} | ₿ BTC.D: ${sent.btcDominance}% | 📰 ${sent.newsSentimentScore > 0 ? '+' : ''}${sent.newsSentimentScore}\n\n`;

        setups.forEach((s, i) => {
            const mSweep   = s.liquiditySweep !== 'None' ? `\n   💧 ${s.liquiditySweep}` : '';
            const mChoch   = s.choch !== 'None'          ? `\n   🔄 ${s.choch}` : '';
            const catLine  = s.tradeCategory             ? `\n   📅 ${s.tradeCategory}` : '';
            const orderTag = s.orderType
                ? (s.orderType.includes('LIMIT') ? '\n   📋 ⏳ LIMIT ORDER' : '\n   📋 ⚡ MARKET ORDER')
                : '';
            outMsg +=
                `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐) ${s.sentEmoji || ''}\n` +
                `   📍 Price: $${s.price}\n   🔥 ADX: ${s.adx}\n` +
                `   ✔️ Reasons: ${s.reasons}${mSweep}${mChoch}${catLine}${orderTag}\n` +
                `   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
        });
        outMsg += `${wsStatus}\n${scanStatus}`;

        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── Exports for settings.js ───────────────────────────────────
function getScannerStatus() {
    return _scannerActive;
}

/**
 * Called by settings.js when the user enables the scanner.
 * Initialises the WebSocket (idempotent), starts trade manager,
 * then attaches the event-driven signal scanner.
 */
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

module.exports = { getScannerStatus, startScannerFromSettings, stopScannerFromSettings };
