const { cmd } = require('../lib/commands');
const config = require('../config');
const db = require('../lib/database');
const axios = require('axios');
const binance = require('../lib/binance');
const analyzer = require('../lib/analyzer');

// ─── Sentiment Cache ───
let cachedSentiment = null;
let sentimentCacheTime = 0;
const SENTIMENT_CACHE_MS = 5 * 60 * 1000;

async function getSentimentCached() {
    if (!cachedSentiment || Date.now() - sentimentCacheTime > SENTIMENT_CACHE_MS) {
        cachedSentiment = await binance.getMarketSentiment().catch(() => ({
            totalBias: '0', overallSentiment: 'NEUTRAL', tradingBias: 'Neutral',
            fngEmoji: '⚪', fngValue: 'N/A', btcDominance: 'N/A', newsSentimentScore: 0
        }));
        sentimentCacheTime = Date.now();
    }
    return cachedSentiment;
}

// ─── Top 5 Setups Scanner ───
async function getTopDownSetups() {
    let foundSetups = [];
    const dynamicCoins = await binance.getTopTrendingCoins(30);

    for (let coin of dynamicCoins) {
        try {
            await new Promise(resolve => setTimeout(resolve, 200));
            const aData = await analyzer.run14FactorAnalysis(coin, '15m');

            if (aData.score >= 10) {  // 10/30 = 33% confluence minimum
                const sent = await getSentimentCached();
                const sentBias = parseFloat(sent.totalBias) || 0;
                const sentBonus =
                    (aData.direction === 'LONG'  && sentBias >= 1)  ?  1 :
                    (aData.direction === 'SHORT' && sentBias <= -1) ?  1 :
                    (aData.direction === 'LONG'  && sentBias <= -1) ? -1 :
                    (aData.direction === 'SHORT' && sentBias >= 1)  ? -1 : 0;
                const adjustedScore = aData.score + sentBonus;

                foundSetups.push({
                    coin: coin.replace('USDT', ''),
                    type: aData.direction === 'LONG' ? 'LONG 🟢' : 'SHORT 🔴',
                    rawScore: adjustedScore,
                    score: `${adjustedScore}/30`,
                    price: aData.priceStr,
                    tp1: aData.tp1,
                    tp: aData.tp2,
                    sl: aData.sl,
                    adx: aData.adxData.value,
                    reasons: aData.reasons,
                    liquiditySweep: aData.liquiditySweep || 'None',
                    choch: aData.choch || 'None',
                    supertrend: aData.supertrend ? aData.supertrend.display : '',
                    rvol: aData.rvol ? aData.rvol.rvol : '?',
                    sentEmoji: sentBonus > 0 ? '📰✅' : sentBonus < 0 ? '📰⚠️' : ''
                });
            }
        } catch (err) { }
    }

    foundSetups.sort((a, b) => b.rawScore - a.rawScore);
    return foundSetups.slice(0, 5);
}

// ─── Scanner State ───
let activeScannerLoop = null;
let activeTradeManager = null;

// ─── Trade Manager Loop ───────────────────────────────────────
function startTradeManager(conn) {
    if (activeTradeManager) return;

    activeTradeManager = setInterval(async () => {
        try {
            const activeTrades = await db.Trade.find({ status: { $in: ['active', 'pending'] } });
            if (!activeTrades || activeTrades.length === 0) return;
            const currentSettings = await db.getSettings();

            for (let trade of activeTrades) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`, { timeout: 5000 });
                    const currentPrice = parseFloat(res.data.price);
                    const isLong   = trade.direction === 'LONG';
                    const isPaper  = !!trade.isPaper;
                    const cb       = trade.coin.replace('USDT', '');
                    const de       = isLong ? '🟢' : '🔴';
                    const dir      = trade.direction;

                    // ── PENDING → FILL ────────────────────────
                    if (trade.status === 'pending') {
                        const hit = isLong ? currentPrice <= trade.entry : currentPrice >= trade.entry;
                        if (hit) {
                            trade.status   = 'active';
                            trade.fillPrice = currentPrice;
                            await trade.save();
                            if (isPaper) {
                                await conn.sendMessage(trade.userJid, { text:
                                    `🤖 *PAPER ORDER FILLED!* ✅\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `📍 Set: $${parseFloat(trade.entry).toFixed(4)}\n` +
                                    `💹 Fill: $${currentPrice.toFixed(4)}\n\n` +
                                    `🎯 TP1: $${parseFloat(trade.tp1||trade.tp).toFixed(4)}\n` +
                                    `🎯 TP2: $${parseFloat(trade.tp2||trade.tp).toFixed(4)}\n` +
                                    `🛡️ SL:  $${parseFloat(trade.sl).toFixed(4)}\n\n` +
                                    `📊 *.myptrades* ගසා Live P&L බලන්න`
                                });
                            } else {
                                await conn.sendMessage(trade.userJid, { text:
                                    `🔔 *LIMIT ORDER ENTRY ZONE!*\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `📍 Entry Zone: $${parseFloat(trade.entry).toFixed(4)}\n` +
                                    `💹 Current: $${currentPrice.toFixed(4)}\n\n` +
                                    `✅ *Exchange හිදී Order Fill Confirm කරන්න!*\n\n` +
                                    `🎯 TP1: $${parseFloat(trade.tp1||trade.tp).toFixed(4)}\n` +
                                    `🎯 TP2: $${parseFloat(trade.tp2||trade.tp).toFixed(4)}\n` +
                                    `🛡️ SL:  $${parseFloat(trade.sl).toFixed(4)}`
                                });
                            }
                        }
                        continue;
                    }

                    // ── TP1 HIT ───────────────────────────────
                    if (trade.tp1 && !trade.tp1Hit) {
                        const tp1v   = parseFloat(trade.tp1);
                        const tp1Hit = isLong ? currentPrice >= tp1v : currentPrice <= tp1v;
                        if (tp1Hit) {
                            trade.tp1Hit = true;
                            if (isPaper) {
                                const pQty = (trade.quantity || 0) * 0.33;
                                const pPnl = Math.abs(tp1v - trade.entry) * pQty;
                                await db.updatePaperBalance(trade.userJid, pPnl, false, false);
                                trade.sl = trade.entry; // move SL to break-even
                                await trade.save();
                                await conn.sendMessage(trade.userJid, { text:
                                    `🎯 *PAPER TP1 HIT!* 💰\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `✅ TP1: $${tp1v.toFixed(4)} Hit!\n` +
                                    `💰 +33% Profit: +$${pPnl.toFixed(2)} ✅ Auto-booked\n` +
                                    `🛡️ SL → Entry (Break-even) ✅ Auto-moved\n\n` +
                                    `🎯 TP2: $${parseFloat(trade.tp2||trade.tp).toFixed(4)} targeting...`
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
                                    `• TP2: $${parseFloat(trade.tp2||trade.tp).toFixed(4)} target`
                                });
                            }
                        }
                    }

                    // ── TP2 HIT ───────────────────────────────
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
                                    `🎯 Remaining 34% → TP3: $${parseFloat(trade.tp).toFixed(4)}`
                                });
                            } else {
                                await conn.sendMessage(trade.userJid, { text:
                                    `🎯 *TP2 HIT!* 🔥\n━━━━━━━━━━━━━━━━\n` +
                                    `🪙 *${cb}/USDT* ${de} *${dir}*\n\n` +
                                    `🔥 TP2: $${tp2v.toFixed(4)} Hit!\n\n` +
                                    `*Exchange හිදී කරන්න:*\n` +
                                    `• Position ෙන් 33% Close කරන්න\n` +
                                    `• TP3: $${parseFloat(trade.tp).toFixed(4)} target hold`
                                });
                            }
                        }
                    }

                    // ── DCA ZONE ──────────────────────────────
                    if (trade.dcaLevel === 0) {
                        const risk   = Math.abs(trade.entry - trade.sl);
                        const dcaZone = isLong ? trade.entry - risk * 0.7 : trade.entry + risk * 0.7;
                        const atDca  = isLong
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
                                `\n\n⚠️ _SL zone ළඟා නොවූ විට DCA කරන්න!_`
                            });
                        }
                    }

                    // ── TRAILING SL (Break-even) ───────────────
                    if (currentSettings.trailingSl && !trade.tp1Hit) {
                        const risk = Math.abs(trade.entry - trade.sl);
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
                                `\n_Trade 100% Risk-Free!_ 🎉`
                            });
                        }
                    }

                    // ── TP3 / SL HIT → CLOSE ─────────────────
                    let hitType = null, result = '';
                    const tp3v = parseFloat(trade.tp), slv = parseFloat(trade.sl);
                    if (isLong) {
                        if (currentPrice >= tp3v)      { hitType = 'TP3'; result = 'WIN'; }
                        else if (currentPrice <= slv)  { hitType = 'SL';  result = slv === parseFloat(trade.entry) ? 'BREAK-EVEN' : 'LOSS'; }
                    } else {
                        if (currentPrice <= tp3v)      { hitType = 'TP3'; result = 'WIN'; }
                        else if (currentPrice >= slv)  { hitType = 'SL';  result = slv === parseFloat(trade.entry) ? 'BREAK-EVEN' : 'LOSS'; }
                    }

                    if (hitType) {
                        const emoji = result === 'WIN' ? '🏆' : result === 'BREAK-EVEN' ? '🛡️' : '💀';

                        if (isPaper) {
                            // Auto-close paper — calculate remaining qty
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
                                `📍 Entry: $${parseFloat(trade.entry).toFixed(4)}\n\n` +
                                `💰 *PnL: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)*\n` +
                                `💼 Balance: $${(user.paperBalance || 0).toFixed(2)}\n\n` +
                                `📜 *.paperhistory* | 📊 *.margin*`
                            });

                        } else {
                            // Real: notify + auto-remove from tracking
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
                                `_✅ Bot tracking ෙන් auto-removed_`
                            });
                        }
                    }

                } catch (e) { /* skip failed coin */ }
            }
        } catch (err) { }
    }, 60000);
}


// ─── Signal Scanner Loop ───
function startSignalScanner(conn, ownerJid) {
    if (activeScannerLoop) return;

    const runScan = async () => {
        try {
            const setups = await getTopDownSetups();
            if (!setups || setups.length === 0) return;

            const sent = await getSentimentCached();
            let msg = `🚀 *14-FACTOR AUTO SIGNAL ALERT* 🚀\n_Top ${setups.length} Best Setups Now_\n\n`;
            msg += `🧠 *Market:* ${sent.overallSentiment} | ${sent.fngEmoji} F&G: ${sent.fngValue}\n\n`;
            setups.forEach((s, i) => {
                msg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐) ${s.sentEmoji || ''}\n   📍 $${s.price} | ADX: ${s.adx} | RVOL: ${s.rvol || '?'}x\n   ⚡ ${s.supertrend || ''}\n   ✔️ ${s.reasons}\n   🤖 .future ${s.coin} 15m\n\n`;
            });
            msg += `_⏱️ ඊළඟ Scan - 5min | .set 1 off ගසා Stop කරන්න_`;

            await conn.sendMessage(ownerJid, { text: msg.trim() });
        } catch (e) { }
    };

    runScan();
    activeScannerLoop = setInterval(runScan, 5 * 60 * 1000);
}

// ─── Manual Scan Command (.scan) ───
cmd({
    pattern: "scan",
    alias: ["superscan", "scanner"],
    desc: "Manual Market Scan - Top 5 Best Setups",
    category: "crypto",
    react: "🔍",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');

        const scanStatus = activeScannerLoop
            ? "🟢 *Auto Scanner:* ON (.set 1 off ගසා Stop)"
            : "🔴 *Auto Scanner:* OFF (.set 1 on ගසා Start)";

        await reply(`🔍 *MANUAL SCAN ක්‍රියාත්මක වේ...*\n${scanStatus}\n\nTop 30 Coins Scan වෙමින් පවතී... ⏳`);

        const setups = await getTopDownSetups();

        if (setups.length === 0) {
            return await reply(`╔═══════════════════════════╗\n║  🔍 *MANUAL SCAN RESULTS*  ║\n╚═══════════════════════════╝\n\nScore 5/14 ට වඩා ලබාගත් Setups දැනට නොමැත. ⚪\n\nකිසිවේලාවකට පසු නැවත .scan ගසන්න.\n\n${scanStatus}`);
        }

        const sent = await getSentimentCached();
        let outMsg = `╔═══════════════════════════╗\n║  🎯 *TOP 5 SNIPER SETUPS*  ║\n╚═══════════════════════════╝\n\n`;
        outMsg += `🧠 *Market Sentiment:* ${sent.overallSentiment}\n`;
        outMsg += `${sent.fngEmoji} F&G: ${sent.fngValue} | ₿ BTC.D: ${sent.btcDominance}% | 📰 ${sent.newsSentimentScore > 0 ? '+' : ''}${sent.newsSentimentScore}\n\n`;
        setups.forEach((s, i) => {
            const mSweep = s.liquiditySweep !== 'None' ? `\n   💧 ${s.liquiditySweep}` : '';
        const mChoch = s.choch !== 'None' ? `\n   🔄 ${s.choch}` : '';
        outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐) ${s.sentEmoji || ''}\n   📍 Price: $${s.price}\n   🔥 ADX: ${s.adx}\n   ✔️ Reasons: ${s.reasons}${mSweep}${mChoch}\n   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
        });
        outMsg += `${scanStatus}`;

        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── Exports for settings.js ───
function getScannerStatus() {
    return !!activeScannerLoop;
}

async function startScannerFromSettings(conn, ownerJid) {
    if (activeScannerLoop) return false;
    startTradeManager(conn);
    startSignalScanner(conn, ownerJid);
    return true;
}

function stopScannerFromSettings() {
    if (!activeScannerLoop && !activeTradeManager) return false;
    if (activeScannerLoop) { clearInterval(activeScannerLoop); activeScannerLoop = null; }
    if (activeTradeManager) { clearInterval(activeTradeManager); activeTradeManager = null; }
    return true;
}

module.exports = { getScannerStatus, startScannerFromSettings, stopScannerFromSettings };
