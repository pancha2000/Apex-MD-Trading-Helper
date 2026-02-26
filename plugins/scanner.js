const { cmd } = require('../lib/commands'); 
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');
const db = require('../lib/database');
const axios = require('axios');

async function getTopDownSetups() {
    let foundSetups = [];
    const dynamicCoins = await binance.getTopTrendingCoins(30);
    
    for (let coin of dynamicCoins) {
        try {
            await new Promise(resolve => setTimeout(resolve, 200));

            const candles15m = await binance.getKlineData(coin, '15m', 200);
            const candles1h  = await binance.getKlineData(coin, '1h', 100);
            const candles4h  = await binance.getKlineData(coin, '4h', 100);

            const currentPrice = parseFloat(candles15m[candles15m.length - 1][4]);
            const adxData = indicators.calculateADX(candles15m.slice(-50));

            const ema50_4h = parseFloat(indicators.calculateEMA(candles4h, 50));
            const trend4H = parseFloat(candles4h[candles4h.length - 1][4]) > ema50_4h ? "UP" : "DOWN";
            const ema50_1h = parseFloat(indicators.calculateEMA(candles1h, 50));
            const trend1H = parseFloat(candles1h[candles1h.length - 1][4]) > ema50_1h ? "UP" : "DOWN";

            const ema200_15m = parseFloat(indicators.calculateEMA(candles15m, 200));
            const ema50_15m  = parseFloat(indicators.calculateEMA(candles15m.slice(-50), 50));
            const rsi_15m    = parseFloat(indicators.calculateRSI(candles15m.slice(-50)));
            const vwap       = indicators.calculateVWAP(candles15m.slice(-50));
            const pattern    = indicators.checkCandlePattern(candles15m);
            const marketSMC  = smc.analyzeSMC(candles15m.slice(-50));
            const macd       = indicators.calculateMACD(candles15m.slice(-50));
            const volBreak   = indicators.checkVolumeBreakout(candles15m.slice(-50));
            const divergence = indicators.checkDivergence(candles15m.slice(-50));

            let longScore = 0, shortScore = 0;
            let longReasons = [], shortReasons = [];

            if (trend4H === "UP" && trend1H === "UP") { longScore++; longReasons.push("MTF Bull"); }
            if (trend4H === "DOWN" && trend1H === "DOWN") { shortScore++; shortReasons.push("MTF Bear"); }
            
            let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
            if (currentPrice > ema200_15m && diffFromEma50 < 0.008) { longScore++; longReasons.push("EMA Pullback"); }
            if (currentPrice < ema200_15m && diffFromEma50 < 0.008) { shortScore++; shortReasons.push("EMA Pullback"); }
            
            if (marketSMC.bullishOB || marketSMC.bullishFVG !== "None") { longScore++; longReasons.push("Bull SMC"); }
            if (marketSMC.bearishOB || marketSMC.bearishFVG !== "None") { shortScore++; shortReasons.push("Bear SMC"); }
            
            if (rsi_15m < 50) { longScore++; longReasons.push("RSI Oversold"); }
            if (rsi_15m > 50) { shortScore++; shortReasons.push("RSI Overbought"); }
            
            if (vwap.includes('🟢')) { longScore++; longReasons.push("VWAP Support"); }
            if (vwap.includes('🔴')) { shortScore++; shortReasons.push("VWAP Resist"); }
            
            if (pattern.includes('🟢')) { longScore++; longReasons.push(`Pattern`); }
            if (pattern.includes('🔴')) { shortScore++; shortReasons.push(`Pattern`); }
            
            if (volBreak.includes('Bullish')) { longScore++; longReasons.push("Vol Spike"); }
            if (volBreak.includes('Bearish')) { shortScore++; shortReasons.push("Vol Spike"); }
            
            if (divergence.includes('Bullish')) { longScore++; longReasons.push("Divergence"); }
            if (divergence.includes('Bearish')) { shortScore++; shortReasons.push("Divergence"); }
            
            if (macd.includes('Bullish')) { longScore++; longReasons.push("MACD Bull"); }
            if (macd.includes('Bearish')) { shortScore++; shortReasons.push("MACD Bear"); }
            
            if (marketSMC.sweep.includes('Bullish') || marketSMC.choch.includes('Bullish')) { longScore++; longReasons.push("Sweep/ChoCH"); }
            if (marketSMC.sweep.includes('Bearish') || marketSMC.choch.includes('Bearish')) { shortScore++; shortReasons.push("Sweep/ChoCH"); }

            if (longScore >= 4) {
                foundSetups.push({ coin: coin.replace('USDT', ''), type: 'LONG 🟢', rawScore: longScore, score: `${longScore}/10`, price: currentPrice.toFixed(4), adx: adxData.value, entryPoint: ema50_15m.toFixed(4), reasons: longReasons.join(', ') });
            }
            if (shortScore >= 4) {
                foundSetups.push({ coin: coin.replace('USDT', ''), type: 'SHORT 🔴', rawScore: shortScore, score: `${shortScore}/10`, price: currentPrice.toFixed(4), adx: adxData.value, entryPoint: ema50_15m.toFixed(4), reasons: shortReasons.join(', ') });
            }
        } catch (err) { }
    }

    foundSetups.sort((a, b) => b.rawScore - a.rawScore);
    return foundSetups.slice(0, 5);
}

let activeScannerLoop = null;
let activeTradeManager = null;

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
        return await reply("⚠️ Auto Scanner & Trade Manager දැනටමත් ක්‍රියාත්මකයි!\nනැවැත්වීමට `.scanstop` භාවිතා කරන්න.");
    }

    const settings = await db.getSettings();
    if (!settings.autoSignal) {
        return await reply("⚠️ *අවවාදයයි:* Bot Settings වල Auto Signals OFF වී ඇත!\nපළමුව `.set 1 on` ලෙස යවා සක්‍රිය කර, නැවත `.scanstart` ලබා දෙන්න.");
    }

    const targetChat = m.from || mek.from;
    await reply("✅ *AUTO ENGINE STARTED!*\n\nමෙම චැට් එකට සෑම විනාඩි 5කට වරක්ම Top 5 Signals ලැබෙනු ඇත. පළමු ස්කෑන් කිරීම දැන් සිදුවේ... ⏳");

    activeTradeManager = setInterval(async () => {
        try {
            const currentSettings = await db.getSettings();
            // ✅ FIX: Active සහ Pending යන දෙවර්ගයේම Trades ලබාගැනීම
            const activeTrades = await db.Trade.find({ status: { $in: ['active', 'pending'] } });
            if (!activeTrades || activeTrades.length === 0) return;

            for (let trade of activeTrades) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`);
                    const currentPrice = parseFloat(res.data.price);
                    const isLong = trade.direction === 'LONG';

                    // ─── PENDING ORDER CHECK (LIMIT ORDERS) ───
                    if (trade.status === 'pending') {
                        let triggered = false;
                        // Long එකකදී current price එක entry එකට හෝ ඊට පහළට යා යුතුය
                        if (isLong && currentPrice <= trade.entry) triggered = true;
                        // Short එකකදී current price එක entry එකට හෝ ඊට ඉහළට යා යුතුය
                        if (!isLong && currentPrice >= trade.entry) triggered = true;

                        if (triggered) {
                            trade.status = 'active';
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `✅ *ORDER FILLED!* 🔔\n🪙 ${trade.coin} (${trade.direction})\n\nMarket එක ඔබේ Entry Price ($${trade.entry}) වෙත පැමිණ ඇත.\n_දැන් සිට Trade එක Active වන අතර TP/SL Alert ක්‍රියාත්මක වේ!_ 🚀` });
                        }
                        continue; // Order එක Active වුණා පමණයි. අදාල TP/SL check කිරීම මීළඟ විනාඩියේදී සිදුවේ.
                    }

                    // ─── ACTIVE TRADE CHECKS (TP, SL, Trailing) ───
                    if (currentSettings.partialTp && trade.tp1 && !trade.tp1Hit) {
                        const tp1Hit = isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1;
                        if (tp1Hit) {
                            trade.tp1Hit = true;
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `✅ *PARTIAL TP HIT!* 🎯\n🪙 ${trade.coin} (${trade.direction})\nMarket එක TP1 ($${parseFloat(trade.tp1).toFixed(4)}) වෙත පැමිණ ඇත. ලාභයෙන් 50% ක් Close කරන්න!` });
                        }
                    }

                    if (currentSettings.trailingSl) {
                        const riskAmount = Math.abs(trade.entry - trade.sl);
                        const breakEvenTarget = isLong ? (trade.entry + riskAmount) : (trade.entry - riskAmount);
                        let shouldTrail = false;
                        if (isLong && currentPrice >= breakEvenTarget && trade.sl < trade.entry) { trade.sl = trade.entry; shouldTrail = true; }
                        else if (!isLong && currentPrice <= breakEvenTarget && trade.sl > trade.entry) { trade.sl = trade.entry; shouldTrail = true; }
                        if (shouldTrail) {
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `🛡️ *FAST TRAILING SL ACTIVATED!*\n🪙 ${trade.coin} (${trade.direction})\nMarket එක 1:1 Risk/Reward කලාපයට පැමිණ ඇත.\n✅ Stop Loss අගය Entry ($${parseFloat(trade.entry).toFixed(4)}) වෙත ගෙන එන ලදී.\n_මෙම Trade එක දැන් 100% ක් Risk-Free වේ!_ 🎉` });
                        }
                    }

                    let closed = false, result = '', pnlPct = 0;
                    if (isLong) {
                        if (currentPrice >= trade.tp) { closed = true; result = 'WIN'; pnlPct = ((trade.tp - trade.entry)/trade.entry)*100*10; }
                        else if (currentPrice <= trade.sl) { closed = true; result = trade.sl === trade.entry ? 'BREAK-EVEN' : 'LOSS'; pnlPct = ((currentPrice - trade.entry)/trade.entry)*100*10; }
                    } else {
                        if (currentPrice <= trade.tp) { closed = true; result = 'WIN'; pnlPct = ((trade.entry - trade.tp)/trade.entry)*100*10; }
                        else if (currentPrice >= trade.sl) { closed = true; result = trade.sl === trade.entry ? 'BREAK-EVEN' : 'LOSS'; pnlPct = ((trade.entry - currentPrice)/trade.entry)*100*10; }
                    }

                    if (closed) {
                        await db.closeTrade(trade._id, result, pnlPct);
                        const emoji = result === 'WIN' ? '🏆' : result === 'BREAK-EVEN' ? '🛡️' : '💀';
                        await conn.sendMessage(trade.userJid, { text: `${emoji} *TRADE CLOSED!*\n🪙 ${trade.coin} (${trade.direction})\nප්‍රතිඵලය: *${result}*\nවසන ලද මිල: $${currentPrice.toFixed(4)}\n\n_මෙම දත්ත ඔබගේ .stats වෙත එක් කරන ලදී._` });
                    }
                } catch(e) {}
            }
        } catch(err) { }
    }, 60000);

    const runAutoScan = async () => {
        try {
            const currentSettings = await db.getSettings();
            if (!currentSettings.autoSignal) return;

            let setups = await getTopDownSetups();
            
            if (setups.length > 0) {
                let outMsg = `🚀 *10-FACTOR SUPER SNIPER ALERT* 🚀\n_Top 5 Best Market Setups_ \n\n`;
                setups.forEach((s, i) => {
                    outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score})\n   📍 Price: $${s.price}\n   🔥 ADX Trend: ${s.adx}\n   ✔️ Reasons: ${s.reasons}\n   ⏳ *Recommended:* 15m (Scalp)\n   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
                });
                await conn.sendMessage(targetChat, { text: outMsg.trim() });
            }
        } catch (error) { }
    };

    runAutoScan();
    activeScannerLoop = setInterval(runAutoScan, 5 * 60 * 1000);
});

cmd({
    pattern: "scanstop",
    desc: "Stop Auto Scanner & Trade Manager",
    category: "owner",
    isOwner: true,
    react: "🛑",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    if (!activeScannerLoop && !activeTradeManager) {
        return await reply("⚠️ Scanner එක දැනටමත් නවතා ඇත.");
    }
    
    if (activeScannerLoop) clearInterval(activeScannerLoop);
    if (activeTradeManager) clearInterval(activeTradeManager);
    
    activeScannerLoop = null;
    activeTradeManager = null;
    
    await reply("🛑 Auto Scanner සහ Trade Manager සාර්ථකව නවත්වන ලදී.");
});

cmd({
    pattern: "superscan",
    alias: ["scan", "scanner"],
    desc: "10-Factor Super Market Scanner (Top 5 Setups)",
    category: "crypto",
    react: "🚀",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');
        await reply(`🚀 *10-Factor Super Scanner ක්‍රියාත්මක වේ...*\n(Top 30 Trending Coins පරීක්ෂා කර හොඳම 5 තෝරාගනිමින් පවතී...)`);
        
        let setups = await getTopDownSetups();
        
        if (setups.length === 0) {
            return await reply(`╔═══════════════════════════╗\n║ 🔍 *SUPER SCAN RESULTS* ║\n╚═══════════════════════════╝\n\nමෙම මොහොතේ ලකුණු 4/10 ට වඩා ලබාගත් ෂුවර් Setups කිසිවක් මාකට් එකේ Top Coins 30 තුළ නොමැත. ⚪`);
        }

        let outMsg = `╔═══════════════════════════╗\n║ 🎯 *TOP 5 SNIPER SETUPS* ║\n╚═══════════════════════════╝\n\n`;
        setups.forEach((s, i) => {
            outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐)\n   📍 Price: $${s.price}\n   🔥 ADX Trend: ${s.adx}\n   ✔️ Reasons: ${s.reasons}\n   ⏳ *Recommended:* 15m (Scalp)\n   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
        });
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
