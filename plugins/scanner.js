const { cmd } = require('./commands'); 
const config = require('../config');
const binance = require('./binance');
const indicators = require('./indicators');
const smc = require('./smartmoney');
const db = require('./database');
const axios = require('axios');

// 🧠 1. SUPER SCANNER: Confluence Scoring & Dynamic Coin Fetching
async function getTopDownSetups() {
    let foundSetups = [];
    
    // 🚀 Top 30 Trending Coins ලබා ගැනීම
    const dynamicCoins = await binance.getTopTrendingCoins(30);
    console.log(`🔍 Super-Scanning Top ${dynamicCoins.length} Trending Coins...`);
    
    for (let coin of dynamicCoins) {
        try {
            // 🛡️ API බ්ලොක් වීම වළක්වා ගැනීමට මිලි තත්පර 200ක විරාමයක් (Rate Limit Protection)
            await new Promise(resolve => setTimeout(resolve, 200));

            const candles15m = await binance.getKlineData(coin, '15m', 200);
            const candles1h = await binance.getKlineData(coin, '1h', 100);
            const candles4h = await binance.getKlineData(coin, '4h', 100);

            const currentPrice = parseFloat(candles15m[candles15m.length - 1][4]);

            // 🛑 ADX Trend Strength Filter (Strong Trend අනිවාර්යයි!)
            const adxData = indicators.calculateADX(candles15m.slice(-50));
            if (!adxData.isStrong) continue; 

            // දර්ශක (Indicators) ගණනය
            const ema50_4h = parseFloat(indicators.calculateEMA(candles4h, 50));
            const trend4H = parseFloat(candles4h[candles4h.length - 1][4]) > ema50_4h ? "UP" : "DOWN";
            const ema50_1h = parseFloat(indicators.calculateEMA(candles1h, 50));
            const trend1H = parseFloat(candles1h[candles1h.length - 1][4]) > ema50_1h ? "UP" : "DOWN";

            const ema200_15m = parseFloat(indicators.calculateEMA(candles15m, 200));
            const ema50_15m = parseFloat(indicators.calculateEMA(candles15m.slice(-50), 50));
            const rsi_15m = parseFloat(indicators.calculateRSI(candles15m.slice(-50)));
            const vwap = indicators.calculateVWAP(candles15m.slice(-50));
            const pattern = indicators.checkCandlePattern(candles15m);
            const marketSMC = smc.analyzeSMC(candles15m.slice(-50));

            // 🎯 ලකුණු පුවරුව (Score Board)
            let longScore = 0, shortScore = 0;
            let longReasons = [], shortReasons = [];

            if (trend4H === "UP" && trend1H === "UP") { longScore++; longReasons.push("MTF Bullish"); }
            if (trend4H === "DOWN" && trend1H === "DOWN") { shortScore++; shortReasons.push("MTF Bearish"); }

            let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
            if (currentPrice > ema200_15m && diffFromEma50 < 0.003) { longScore++; longReasons.push("EMA Pullback"); }
            if (currentPrice < ema200_15m && diffFromEma50 < 0.003) { shortScore++; shortReasons.push("EMA Pullback"); }

            if (marketSMC.bullishOB !== "None" || marketSMC.bullishFVG !== "None") { longScore++; longReasons.push("Bull SMC"); }
            if (marketSMC.bearishOB !== "None" || marketSMC.bearishFVG !== "None") { shortScore++; shortReasons.push("Bear SMC"); }

            if (rsi_15m < 45) { longScore++; longReasons.push("RSI Oversold"); }
            if (rsi_15m > 55) { shortScore++; shortReasons.push("RSI Overbought"); }

            if (vwap.includes('🟢')) { longScore++; longReasons.push("Above VWAP"); }
            if (vwap.includes('🔴')) { shortScore++; shortReasons.push("Below VWAP"); }

            if (pattern.includes('🟢')) { longScore++; longReasons.push(`Pattern`); }
            if (pattern.includes('🔴')) { shortScore++; shortReasons.push(`Pattern`); }

            // 🏆 STRICT MODE: ලකුණු 5 ක් හෝ ඊට වැඩි (A+ Quality) නම් පමණක් ලබා ගනී!
            if (longScore >= 5) {
                foundSetups.push({ coin: coin.replace('USDT', ''), type: 'LONG 🟢', score: `${longScore}/6`, price: currentPrice.toFixed(2), adx: adxData.value, entryPoint: ema50_15m.toFixed(2), reasons: longReasons.join(', ') });
            }
            if (shortScore >= 5) {
                foundSetups.push({ coin: coin.replace('USDT', ''), type: 'SHORT 🔴', score: `${shortScore}/6`, price: currentPrice.toFixed(2), adx: adxData.value, entryPoint: ema50_15m.toFixed(2), reasons: shortReasons.join(', ') });
            }

        } catch (err) { /* Skip errors for individual coins to keep scanning */ }
    }
    return foundSetups;
}

// 🔄 2. Background Scanner Engine
function startScanner(conn) {
    console.log('🚀 Super Scanner Engine Started...');

    // ─── TASK 1: ACTIVE TRADE MANAGER (හැම විනාඩියකටම වරක්) ───
    setInterval(async () => {
        try {
            const settings = await db.getSettings();
            const activeTrades = await db.Trade.find({ status: 'active' });
            if (!activeTrades || activeTrades.length === 0) return;

            for (let trade of activeTrades) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`);
                    const currentPrice = parseFloat(res.data.price);
                    const isLong = trade.direction === 'LONG';

                    // 🎯 Partial TP1 Alert
                    if (settings.partialTp && trade.tp1 && !trade.tp1Hit) {
                        const tp1Hit = isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1;
                        if (tp1Hit) {
                            trade.tp1Hit = true;
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `✅ *PARTIAL TP HIT!* 🎯\n🪙 ${trade.coin} (${trade.direction})\nMarket එක TP1 ($${trade.tp1}) වෙත පැමිණ ඇත. ලාභයෙන් 50% ක් Close කරන්න!` });
                        }
                    }

                    // 🛡️ FAST TRAILING SL (Break-Even at 1:1 RRR)
                    if (settings.trailingSl) {
                        const riskAmount = Math.abs(trade.entry - trade.sl);
                        const breakEvenTarget = isLong ? (trade.entry + riskAmount) : (trade.entry - riskAmount);
                        
                        let shouldTrail = false;
                        if (isLong && currentPrice >= breakEvenTarget && trade.sl < trade.entry) {
                            trade.sl = trade.entry; shouldTrail = true;
                        } else if (!isLong && currentPrice <= breakEvenTarget && trade.sl > trade.entry) {
                            trade.sl = trade.entry; shouldTrail = true;
                        }

                        if (shouldTrail) {
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `🛡️ *FAST TRAILING SL ACTIVATED!*\n🪙 ${trade.coin} (${trade.direction})\nMarket එක 1:1 Risk/Reward කලාපයට පැමිණ ඇත.\n✅ Stop Loss අගය Entry ($${trade.entry}) වෙත ගෙන එන ලදී.\n_මෙම Trade එක දැන් 100% ක් Risk-Free වේ!_ 🎉` });
                        }
                    }

                    // 🛑 Close Trades (TP2 or SL Hit)
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
                        await conn.sendMessage(trade.userJid, { text: `${emoji} *TRADE CLOSED!*\n🪙 ${trade.coin} (${trade.direction})\nප්‍රතිඵලය: *${result}*\nවසන ලද මිල: $${currentPrice}\n\n_මෙම දත්ත ඔබගේ .stats වෙත එක් කරන ලදී._` });
                    }
                } catch(e) { /* Ignore */ }
            }
        } catch(err) { console.log("Trade Manager Error:", err.message); }
    }, 60000); 

    // ─── TASK 2: SUPER AUTO SIGNALS (හැම විනාඩි 5 කට වරක්) ───
    setInterval(async () => {
        try {
            const settings = await db.getSettings();
            if (!settings.autoSignal) return;

            let botNumber = conn.user.id.split(':')[0] + '@s.whatsapp.net'; 
            let setups = await getTopDownSetups();
            
            if (setups.length > 0) {
                let outMsg = `🚀 *SUPER SNIPER ALERT* 🚀\n_Top Market Setups (Score 5/6+)_ \n\n`;
                setups.forEach((s, i) => {
                    outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score})\n   🔥 ADX Trend: ${s.adx} (Strong)\n   ✔️ Confirmations: ${s.reasons}\n   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
                });
                await conn.sendMessage(botNumber, { text: outMsg.trim() });
            }
        } catch (error) { console.log("AutoSignal Error:", error.message); }
    }, 5 * 60 * 1000); // ⏱️ දැන් විනාඩි 5න් 5ට ස්කෑන් වෙනවා!
}

// 🎯 3. MANUAL COMMAND (.superscan)
cmd({
    pattern: "superscan",
    alias: ["scan", "scanner"], // .scan ගැහුවත් මේකම වැඩ කරනවා
    desc: "Super Market Scanner (Top 30 Coins)",
    category: "crypto",
    react: "🚀",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');
        await reply(`🚀 *Super Scanner ක්‍රියාත්මක වේ...*\n(Top 30 Trending Coins සහ A+ සාධක පරීක්ෂා කරමින් පවතී. කරුණාකර තත්පර කිහිපයක් රැඳී සිටින්න...)`);
        
        let setups = await getTopDownSetups();
        
        if (setups.length === 0) {
            return await reply(`╔═══════════════════════════╗\n║ 🔍 *SUPER SCAN RESULTS* ║\n╚═══════════════════════════╝\n\nමෙම මොහොතේ ලකුණු 5/6 ට වඩා ලබාගත් 100% ෂුවර් (A+ Quality) Setups කිසිවක් මාකට් එකේ Top Coins 30 තුළ නොමැත. ⚪`);
        }

        let outMsg = `╔═══════════════════════════╗\n║ 🎯 *SUPER SNIPER SETUPS* ║\n╚═══════════════════════════╝\n\n`;
        setups.forEach((s, i) => {
            outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐)\n   📍 Price: $${s.price}\n   🔥 ADX Trend: ${s.adx}\n   ✔️ Confirmations: ${s.reasons}\n   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
        });
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

module.exports = { startScanner };
