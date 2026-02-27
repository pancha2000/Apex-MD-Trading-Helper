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

            if (aData.score >= 7) {
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
                    score: `${adjustedScore}/26`,
                    price: aData.priceStr,
                    tp1: aData.tp1,
                    tp: aData.tp2,
                    sl: aData.sl,
                    adx: aData.adxData.value,
                    reasons: aData.reasons,
                    liquiditySweep: aData.liquiditySweep || 'None',
                    choch: aData.choch || 'None',
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

// ─── Trade Manager Loop (Real Trades) ───
function startTradeManager(conn) {
    if (activeTradeManager) return;

    activeTradeManager = setInterval(async () => {
        try {
            const activeTrades = await db.Trade.find({ status: { $in: ['active', 'pending'] } });
            if (!activeTrades || activeTrades.length === 0) return;

            const currentSettings = await db.getSettings();

            for (let trade of activeTrades) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`);
                    const currentPrice = parseFloat(res.data.price);
                    const isLong = trade.direction === 'LONG';

                    // PENDING ORDER CHECK
                    if (trade.status === 'pending') {
                        const triggered = isLong ? currentPrice <= trade.entry : currentPrice >= trade.entry;
                        if (triggered) {
                            trade.status = 'active';
                            await trade.save();
                            await conn.sendMessage(trade.userJid, {
                                text: `✅ *ORDER FILLED!* 🔔\n🪙 ${trade.coin} (${trade.direction})\nEntry Price ($${trade.entry}) Hit!`
                            });
                        }
                        continue;
                    }

                    // PARTIAL TP1 CHECK
                    if (currentSettings.partialTp && trade.tp1 && !trade.tp1Hit) {
                        const tp1Hit = isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1;
                        if (tp1Hit) {
                            trade.tp1Hit = true;
                            await trade.save();
                            await conn.sendMessage(trade.userJid, {
                                text: `✅ *PARTIAL TP HIT!* 🎯\n🪙 ${trade.coin} (${trade.direction})\nTP1 ($${parseFloat(trade.tp1).toFixed(4)}) Hit!\nලාභයෙන් 50% ක් Close කරන්න!`
                            });
                        }
                    }

                    // TRAILING SL CHECK
                    if (currentSettings.trailingSl) {
                        const riskAmount = Math.abs(trade.entry - trade.sl);
                        const breakEvenTarget = isLong ? trade.entry + riskAmount : trade.entry - riskAmount;
                        let shouldTrail = false;

                        if (isLong && currentPrice >= breakEvenTarget && trade.sl < trade.entry) { trade.sl = trade.entry; shouldTrail = true; }
                        else if (!isLong && currentPrice <= breakEvenTarget && trade.sl > trade.entry) { trade.sl = trade.entry; shouldTrail = true; }

                        if (shouldTrail) {
                            await trade.save();
                            await conn.sendMessage(trade.userJid, {
                                text: `🛡️ *TRAILING SL ACTIVATED!*\n🪙 ${trade.coin} (${trade.direction})\nStop Loss → Entry ($${parseFloat(trade.entry).toFixed(4)})\n_Trade 100% Risk-Free!_ 🎉`
                            });
                        }
                    }

                    // CLOSE CHECK (TP or SL)
                    let closed = false, result = '', pnlPct = 0;
                    if (isLong) {
                        if (currentPrice >= trade.tp)  { closed = true; result = 'WIN';        pnlPct = ((trade.tp - trade.entry) / trade.entry) * 100 * 10; }
                        else if (currentPrice <= trade.sl) { closed = true; result = trade.sl === trade.entry ? 'BREAK-EVEN' : 'LOSS'; pnlPct = ((trade.sl - trade.entry) / trade.entry) * 100 * 10; }
                    } else {
                        if (currentPrice <= trade.tp)  { closed = true; result = 'WIN';        pnlPct = ((trade.entry - trade.tp) / trade.entry) * 100 * 10; }
                        else if (currentPrice >= trade.sl) { closed = true; result = trade.sl === trade.entry ? 'BREAK-EVEN' : 'LOSS'; pnlPct = ((trade.entry - trade.sl) / trade.entry) * 100 * 10; }
                    }

                    if (closed) {
                        await db.closeTrade(trade._id, result, pnlPct, 0);
                        const emoji = result === 'WIN' ? '🏆' : result === 'BREAK-EVEN' ? '🛡️' : '💀';
                        await conn.sendMessage(trade.userJid, {
                            text: `${emoji} *TRADE CLOSED!*\n🪙 ${trade.coin} (${trade.direction})\nප්‍රතිඵලය: *${result}*\nවසන ලද මිල: $${currentPrice.toFixed(4)}`
                        });
                    }
                } catch (e) { }
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
                msg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐) ${s.sentEmoji || ''}\n   📍 $${s.price} | ADX: ${s.adx}\n   ✔️ ${s.reasons}\n   🤖 .future ${s.coin} 15m\n\n`;
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
