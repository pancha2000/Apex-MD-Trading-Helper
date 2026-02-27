const { cmd } = require('../lib/commands'); 
const config = require('../config');
const db = require('../lib/database');
const axios = require('axios');
const binance = require('../lib/binance');
const analyzer = require('../lib/analyzer'); // ✅ අලුත් මොළය සම්බන්ධ කළා

// ✅ Cache sentiment data (1 per scan cycle, not per coin)
let cachedSentiment = null;
let sentimentCacheTime = 0;
const SENTIMENT_CACHE_MS = 5 * 60 * 1000; // 5 minutes

async function getSentimentCached() {
    if (!cachedSentiment || Date.now() - sentimentCacheTime > SENTIMENT_CACHE_MS) {
        cachedSentiment = await binance.getMarketSentiment().catch(() => ({ totalBias: '0', overallSentiment: 'NEUTRAL', tradingBias: 'Neutral' }));
        sentimentCacheTime = Date.now();
    }
    return cachedSentiment;
}

// ─── 1. TOP 5 SETUPS SCANNER ───
async function getTopDownSetups() {
    let foundSetups = [];
    const dynamicCoins = await binance.getTopTrendingCoins(30);
    
    for (let coin of dynamicCoins) {
        try {
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // 🧠 Analyzer එකෙන් කෙලින්ම Data ගන්නවා (කලින් පේළි 100ක වැඩේ දැන් එක පේළියයි!)
            const aData = await analyzer.run14FactorAnalysis(coin, '15m');

            if (aData.score >= 5) {
                const sent = await getSentimentCached();
                const sentBias = parseFloat(sent.totalBias) || 0;
                // ✅ Sentiment bonus/penalty on score
                const sentBonus = 
                    (aData.direction === 'LONG' && sentBias >= 1) ? 1 :
                    (aData.direction === 'SHORT' && sentBias <= -1) ? 1 :
                    (aData.direction === 'LONG' && sentBias <= -1) ? -1 :
                    (aData.direction === 'SHORT' && sentBias >= 1) ? -1 : 0;
                const adjustedScore = aData.score + sentBonus;

                const typeStr = aData.direction === 'LONG' ? 'LONG 🟢' : 'SHORT 🔴';
                const sentEmoji = sentBonus > 0 ? '📰✅' : sentBonus < 0 ? '📰⚠️' : '';
                foundSetups.push({
                    coin: coin.replace('USDT', ''),
                    type: typeStr,
                    rawScore: adjustedScore,
                    score: `${adjustedScore}/15`,  // 14 tech + 1 sentiment
                    price: aData.priceStr,
                    tp1: aData.tp1,
                    tp: aData.tp2,
                    sl: aData.sl,
                    adx: aData.adxData.value,
                    reasons: aData.reasons,
                    sentEmoji,
                    sentBias: sentBias.toFixed(1)
                });
            }
        } catch (err) { }
    }

    foundSetups.sort((a, b) => b.rawScore - a.rawScore);
    return foundSetups.slice(0, 5);
}

let activeScannerLoop = null;
let activeTradeManager = null;

// ─── 2. START AUTO SCANNER & TRADE MANAGER ───
cmd({
    pattern: "scanstart",
    desc: "Start Auto Scanner & Trade Manager",
    category: "owner",
    isOwner: true,
    react: "🚀",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    if (activeScannerLoop || activeTradeManager) {
        return await reply("⚠️ Auto Scanner & Trade Manager දැනටමත් ක්‍රියාත්මකයි!");
    }

    const ownerJid = m.sender || mek.sender;
    await reply("✅ *AUTO ENGINE STARTED!*\n\nමෙම චැට් එකට සෑම විනාඩි 5කට වරක්ම Top 5 Signals ලැබෙනු ඇත. පළමු ස්කෑන් කිරීම දැන් සිදුවේ... ⏳");
    // ✅ NEW: Daily Summary scheduler start
    await startDailySummary(conn, ownerJid);

    // ─── TRADE MANAGER (මිනිත්තුවෙන් මිනිත්තුව Trades පරීක්ෂා කිරීම) ───
    activeTradeManager = setInterval(async () => {
        try {
            const currentSettings = await db.getSettings();
            const activeTrades = await db.Trade.find({ status: { $in: ['active', 'pending'] } });
            if (!activeTrades || activeTrades.length === 0) return;

            for (let trade of activeTrades) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`);
                    const currentPrice = parseFloat(res.data.price);
                    const isLong = trade.direction === 'LONG';

                    // PENDING ORDER CHECK
                    if (trade.status === 'pending') {
                        let triggered = false;
                        if (isLong && currentPrice <= trade.entry) triggered = true;
                        if (!isLong && currentPrice >= trade.entry) triggered = true;
                        if (triggered) {
                            trade.status = 'active';
                            await trade.save();
                            if (!trade.isPaper) await conn.sendMessage(trade.userJid, { text: `✅ *ORDER FILLED!* 🔔\n🪙 ${trade.coin} (${trade.direction})\nMarket එක Entry Price ($${trade.entry}) වෙත පැමිණ ඇත.` });
                        }
                        continue; 
                    }

                    // PARTIAL TP CHECK
                    if (currentSettings.partialTp && trade.tp1 && !trade.tp1Hit) {
                        const tp1Hit = isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1;
                        if (tp1Hit) {
                            trade.tp1Hit = true;
                            await trade.save();
                            if (!trade.isPaper) await conn.sendMessage(trade.userJid, { text: `✅ *PARTIAL TP HIT!* 🎯\n🪙 ${trade.coin} (${trade.direction})\nMarket එක TP1 ($${parseFloat(trade.tp1).toFixed(4)}) වෙත පැමිණ ඇත. ලාභයෙන් 50% ක් Close කරන්න!` });
                        }
                    }

                    // TRAILING SL CHECK
                    if (currentSettings.trailingSl) {
                        const riskAmount = Math.abs(trade.entry - trade.sl);
                        const breakEvenTarget = isLong ? (trade.entry + riskAmount) : (trade.entry - riskAmount);
                        let shouldTrail = false;
                        
                        if (isLong && currentPrice >= breakEvenTarget && trade.sl < trade.entry) { trade.sl = trade.entry; shouldTrail = true; }
                        else if (!isLong && currentPrice <= breakEvenTarget && trade.sl > trade.entry) { trade.sl = trade.entry; shouldTrail = true; }
                        
                        if (shouldTrail) {
                            await trade.save();
                            if (!trade.isPaper) await conn.sendMessage(trade.userJid, { text: `🛡️ *FAST TRAILING SL ACTIVATED!*\n🪙 ${trade.coin} (${trade.direction})\nStop Loss අගය Entry ($${parseFloat(trade.entry).toFixed(4)}) වෙත ගෙන එන ලදී.\n_මෙම Trade එක දැන් 100% ක් Risk-Free වේ!_ 🎉` });
                        }
                    }

                    // CLOSING LOGIC (TP or SL)
                    // ✅ FIX 5: LOSS pnlPct දී currentPrice නොව SL price use කරනවා
                    let closed = false, result = '', pnlPct = 0;
                    if (isLong) {
                        if (currentPrice >= trade.tp) { closed = true; result = 'WIN'; pnlPct = ((trade.tp - trade.entry)/trade.entry)*100*10; }
                        else if (currentPrice <= trade.sl) { closed = true; result = trade.sl === trade.entry ? 'BREAK-EVEN' : 'LOSS'; pnlPct = ((trade.sl - trade.entry)/trade.entry)*100*10; }
                    } else {
                        if (currentPrice <= trade.tp) { closed = true; result = 'WIN'; pnlPct = ((trade.entry - trade.tp)/trade.entry)*100*10; }
                        else if (currentPrice >= trade.sl) { closed = true; result = trade.sl === trade.entry ? 'BREAK-EVEN' : 'LOSS'; pnlPct = ((trade.entry - trade.sl)/trade.entry)*100*10; }
                    }

                    // UPDATE PNL AND BALANCE IF CLOSED
                    if (closed) {
                        let paperProfit = 0;
                        if (trade.isPaper) {
                            const user = await db.getUser(trade.userJid);
                            const riskAmountDollars = user.paperBalance * 0.02; 
                            const slDist = Math.abs(trade.entry - trade.sl);
                            const qty = riskAmountDollars / slDist; 
                            
                            // ✅ FIX 5: LOSS දී currentPrice නොව SL price use කරනවා (නිවැරදි PnL)
                            if (result === 'WIN') { paperProfit = qty * Math.abs(trade.entry - trade.tp); } 
                            else if (result === 'LOSS') { paperProfit = -Math.abs(qty * Math.abs(trade.entry - trade.sl)); }
                            else if (result === 'BREAK-EVEN') { paperProfit = 0; }
                            
                            // ✅ FIX 4: Break-even isBreakEven=true pass කරනවා
                            await db.updatePaperBalance(trade.userJid, paperProfit, result === 'WIN', result === 'BREAK-EVEN');
                        }

                        await db.closeTrade(trade._id, result, pnlPct, paperProfit);
                        
                        let msg = result === 'WIN' ? '🏆' : result === 'BREAK-EVEN' ? '🛡️' : '💀';
                        if (trade.isPaper) {
                            msg = `🤖 *PAPER TRADE CLOSED!*\n🪙 ${trade.coin} (${trade.direction})\nප්‍රතිඵලය: *${result}*\n💰 PnL: ${paperProfit >= 0 ? '+' : ''}$${paperProfit.toFixed(2)}\n_දැන් .settings මගින් හෝ .stats මගින් නව ශේෂය බලන්න._`;
                        } else {
                            msg = `${msg} *TRADE CLOSED!*\n🪙 ${trade.coin} (${trade.direction})\nප්‍රතිඵලය: *${result}*\nවසන ලද මිල: $${currentPrice.toFixed(4)}`;
                        }
                        await conn.sendMessage(trade.userJid, { text: msg });
                    }
                } catch(e) {}
            }
        } catch(err) { }
    }, 60000);

    // ─── AUTO SCANNER LOOP ───
    const runAutoScan = async () => {
        try {
            const currentSettings = await db.getSettings();
            if (!currentSettings.autoSignal && !currentSettings.paperTrade) return;

            let setups = await getTopDownSetups();
            
            // ✅ MAX 3 TRADES & SMART REPLACEMENT LOGIC
            if (currentSettings.paperTrade && setups.length > 0) {
                const user = await db.getUser(ownerJid);
                
                for (let s of setups) {
                    if (s.rawScore >= currentSettings.paperMinScore) {
                        const existingTrade = await db.Trade.findOne({ coin: s.coin + 'USDT', isPaper: true, status: { $in: ['active', 'pending'] } });
                        
                        if (!existingTrade) {
                            // දැනට දුවන Paper Trades ගාණ චෙක් කිරීම
                            const activePaperTrades = await db.Trade.find({ userJid: ownerJid, isPaper: true, status: { $in: ['active', 'pending'] } });
                            
                            // 1. Trades 3 කට වඩා අඩු නම් සාමාන්‍ය පරිදි Trade එක ගනී
                            if (activePaperTrades.length < 3) {
                                await placePaperTrade(s, user, ownerJid, conn);
                            } 
                            // 2. Trades 3 ම පිරී ඇත්නම් (Smart Replacement ක්‍රියාත්මක වේ)
                            else {
                                let replaced = false;
                                for (let activeT of activePaperTrades) {
                                    try {
                                        const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${activeT.coin}`);
                                        const cp = parseFloat(res.data.price);
                                        let pnlPct = activeT.direction === 'LONG' ? ((cp - activeT.entry) / activeT.entry) * 100 : ((activeT.entry - cp) / activeT.entry) * 100;
                                        
                                        // PnL එක -0.5% සහ +0.5% අතර නම් (Break-even කිට්ටුව නම්)
                                        if (pnlPct >= -0.5 && pnlPct <= 0.5) {
                                            // ✅ BUG FIX 1: updatePaperBalance call කිරීම (Break-even trades stats update)
                                            await db.closeTrade(activeT._id, 'BREAK-EVEN', pnlPct, 0);
                                            await db.updatePaperBalance(activeT.userJid, 0, false, true); // isBreakEven=true
                                            await conn.sendMessage(ownerJid, { text: `🔄 *SMART REPLACEMENT ACTIVATED!*\n${activeT.coin} Trade එක Break-even හිදී වසා දමා, අලුත් (Score: ${s.score}) සුපිරි Trade එකට ඉඩ ලබා දෙන ලදී.` });
                                            
                                            // අලුත් Trade එක දායි
                                            await placePaperTrade(s, user, ownerJid, conn);
                                            replaced = true;
                                            break; // එකක් Replace කළාම ඇති
                                        }
                                    } catch (err) {}
                                }
                            }
                        }
                    }
                }
            }

            // සාමාන්‍ය Signal Alert යැවීම (Auto Signal On කර ඇත්නම්)
            if (currentSettings.autoSignal && setups.length > 0) {
                let outMsg = `🚀 *14-FACTOR SUPER SNIPER ALERT* 🚀\n_Top 5 Best Market Setups_ \n\n`;
                setups.forEach((s, i) => {
                    outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score})\n   📍 Price: $${s.price}\n   🔥 ADX Trend: ${s.adx}\n   ✔️ Reasons: ${s.reasons}\n   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
                });
                await conn.sendMessage(ownerJid, { text: outMsg.trim() });
            }
        } catch (error) { }
    };

    runAutoScan();
    activeScannerLoop = setInterval(runAutoScan, 5 * 60 * 1000); 
});

// ─── 3. STOP SCANNER ───
cmd({
    pattern: "scanstop",
    desc: "Stop Auto Scanner & Trade Manager",
    category: "owner",
    isOwner: true,
    react: "🛑",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    if (!activeScannerLoop && !activeTradeManager) return await reply("⚠️ Scanner එක දැනටමත් නවතා ඇත.");
    if (activeScannerLoop) clearInterval(activeScannerLoop);
    if (activeTradeManager) clearInterval(activeTradeManager);
    activeScannerLoop = null; activeTradeManager = null;
    await reply("🛑 Auto Scanner සහ Trade Manager සාර්ථකව නවත්වන ලදී.");
});

// ─── 4. MANUAL SUPERSCAN COMMAND ───
cmd({
    pattern: "superscan",
    alias: ["scan", "scanner"],
    desc: "14-Factor Super Market Scanner (Top 5 Setups)",
    category: "crypto",
    react: "🚀",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');
        await reply(`🚀 *14-Factor Super Scanner ක්‍රියාත්මක වේ...*\n(Top 30 Trending Coins පරීක්ෂා කර හොඳම 5 තෝරාගනිමින් පවතී...)`);
        
        let setups = await getTopDownSetups();
        
        if (setups.length === 0) {
            return await reply(`╔═══════════════════════════╗\n║ 🔍 *SUPER SCAN RESULTS* ║\n╚═══════════════════════════╝\n\nමෙම මොහොතේ ලකුණු 5/14 ට වඩා ලබාගත් ෂුවර් Setups කිසිවක් මාකට් එකේ Top Coins 30 තුළ නොමැත. ⚪`);
        }

        const sentForScan = await getSentimentCached();
        let outMsg = `╔═══════════════════════════╗\n║ 🎯 *TOP 5 SNIPER SETUPS* ║\n╚═══════════════════════════╝\n\n`;
        outMsg += `🧠 *Market Sentiment:* ${sentForScan.overallSentiment}\n`;
        outMsg += `${sentForScan.fngEmoji} F&G: ${sentForScan.fngValue} | ₿ BTC.D: ${sentForScan.btcDominance}% | 📰 News: ${sentForScan.newsSentimentScore > 0 ? '+' : ''}${sentForScan.newsSentimentScore}\n\n`;
        setups.forEach((s, i) => {
            outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐) ${s.sentEmoji || ''}\n   📍 Price: $${s.price}\n   🔥 ADX: ${s.adx}\n   ✔️ Reasons: ${s.reasons}\n   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
        });
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── DAILY SUMMARY (Midnight Auto Report) ───
async function startDailySummary(conn, ownerJid) {
    // සෑම දිනකම midnight UTC 00:00 ට Daily P&L Summary
    const msUntilMidnight = () => {
        const now = new Date();
        const midnight = new Date();
        midnight.setUTCHours(24, 0, 0, 0);
        return midnight - now;
    };

    const sendDailySummary = async () => {
        try {
            const user = await db.getUser(ownerJid);
            const stats = await db.getTradeStats(ownerJid);
            const startBal = user.paperStartBalance || 100;
            const netPnL = user.paperBalance - startBal;
            const pnlEmoji = netPnL >= 0 ? '📈' : '📉';
            const winRate = user.paperTrades > 0 ? ((user.paperWins / user.paperTrades) * 100).toFixed(1) : 0;

            const todayTrades = await db.Trade.find({
                isPaper: true,
                status: 'closed',
                updatedAt: { $gte: new Date(new Date().setUTCHours(0,0,0,0)) }
            }).catch(() => []);

            let todayPnL = 0;
            todayTrades.forEach(t => todayPnL += (t.paperProfit || 0));

            const summary = `
🌙 *DAILY TRADING SUMMARY*
_${new Date().toUTCString().slice(0,16)}_

*🤖 Paper Trading:*
💰 Balance: $${user.paperBalance.toFixed(2)}
${pnlEmoji} Total P&L: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}
📊 Today's P&L: ${todayPnL >= 0 ? '+' : ''}$${todayPnL.toFixed(2)}
🎯 Win Rate: ${winRate}% (${user.paperWins}W / ${user.paperLosses}L)

*📋 Real Trades:*
📌 Active: ${stats.active}
📁 Closed Total: ${stats.total}
🏆 Win Rate: ${stats.winRate}%

_Tomorrow also good trading! 🚀_`;

            await conn.sendMessage(ownerJid, { text: summary.trim() });
        } catch (e) { console.log('Daily summary error:', e.message); }

        // ඊළඟ දිනටත් schedule
        setTimeout(sendDailySummary, msUntilMidnight());
    };

    setTimeout(sendDailySummary, msUntilMidnight());
}

// ─── HELPER FUNCTION: PLACE PAPER TRADE ───
async function placePaperTrade(s, user, ownerJid, conn) {
    const riskAmt = user.paperBalance * 0.02; 
    
    await db.saveTrade({
        userJid: ownerJid,
        coin: s.coin + 'USDT',
        type: 'future',
        direction: s.type.includes('LONG') ? 'LONG' : 'SHORT',
        entry: parseFloat(s.price),
        tp: parseFloat(s.tp),
        tp1: parseFloat(s.tp1),
        sl: parseFloat(s.sl),
        rrr: "1:2.0",
        status: 'active', 
        isPaper: true
    });
    
    await conn.sendMessage(ownerJid, { text: `🤖 *AUTO PAPER TRADE EXECUTED!*\n(Score: ${s.score})\n\n🪙 ${s.coin} | ${s.type.includes('LONG') ? 'LONG 🟢' : 'SHORT 🔴'}\n📍 Entry: $${s.price}\n🎯 TP: $${s.tp}\n🛡️ SL: $${s.sl}\n💰 Risk Amount: $${riskAmt.toFixed(2)}\n\n_මෙය ඔබගේ Virtual Balance එක භාවිතා කර ස්වයංක්‍රීයව දමන ලදී._` });
}