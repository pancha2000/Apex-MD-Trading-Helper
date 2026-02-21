const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');

// අලුතින් වෙන් කළ Modules (Modular Architecture)
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

function formatRecentCandles(candles) {
    const recent = candles.slice(-10);
    return recent.map((c, i) => `C${i + 1}: O=$${parseFloat(c[1]).toFixed(2)}, H=$${parseFloat(c[2]).toFixed(2)}, L=$${parseFloat(c[3]).toFixed(2)}, C=$${parseFloat(c[4]).toFixed(2)}`).join('\n');
}

// ================== SPOT COMMAND ==================
cmd({
    pattern: "spot",
    desc: "Advanced Spot Trading Analysis",
    category: "crypto",
    react: "🟢",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n*උදා:* ${config.PREFIX}spot BTC 4h`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key එක නැහැ!');
        
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        let timeframe = args[1] ? args[1].toLowerCase() : '1d'; 

        await m.react('⏳');
        await reply(`⏳ *Binance (${timeframe}) දත්ත විශ්ලේෂණය කරමින් පවතී...*`);

        // Modules හරහා දත්ත ලබාගැනීම
        const candles = await binance.getKlineData(coin, timeframe);
        const currentPrice = parseFloat(candles[candles.length - 1][4]).toFixed(2); 
        const rsi = indicators.calculateRSI(candles);
        const ema = indicators.calculateEMA(candles);
        const marketSMC = smc.analyzeSMC(candles);

        const prompt = `Analyze ${coin} on ${timeframe} for SPOT TRADING.
        Current Price: $${currentPrice}, RSI: ${rsi}, EMA(50): ${ema}
        Resistance: $${marketSMC.resistance}, Support: $${marketSMC.support}
        Bullish FVG: ${marketSMC.bullishFVG}, Bearish FVG: ${marketSMC.bearishFVG}

        Provide a VERY SHORT analysis using Sinhala mixed with English trading terms.
        Format strictly like this:
        📌 Market Status: (Trend, RSI, EMA status)
        🤖 AI Decision: (BUY/HOLD/WAIT)
        🛡️ Confidence: (e.g., 85%)
        🎯 Targets: Entry, TP, SL
        💡 DCA Strategy: (Explain based on Support/FVG)

        IMPORTANT: At the very end, output exactly:
        [TARGETS|ENTRY:number|TP:number|SL:number]`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const aiResponse = aiRes.data.choices[0].message.content;

        const outMsg = `
╔═══════════════════════════╗
║  🟢 *SPOT TRADE ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe}
💲 *Current Price:* $${currentPrice}

${aiResponse}

> 📌 *මෙම Trade එක Track කිරීමට .track ලෙස Reply කරන්න.*`;
        
        await reply(outMsg);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ================== FUTURES COMMAND ==================
cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Advanced Futures Trading Analysis",
    category: "crypto",
    react: "🔴",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n*උදා:* ${config.PREFIX}future BTC 15m`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key එක නැහැ!');
        
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        let timeframe = args[1] ? args[1].toLowerCase() : '15m'; 

        await m.react('⏳');
        await reply(`⏳ *Binance (${timeframe}) දත්ත විශ්ලේෂණය කරමින් පවතී...*`);

        // Modules හරහා දත්ත ලබාගැනීම
        const candles = await binance.getKlineData(coin, timeframe);
        const currentPrice = parseFloat(candles[candles.length - 1][4]).toFixed(2);
        const rsi = indicators.calculateRSI(candles);
        const ema = indicators.calculateEMA(candles);
        const marketSMC = smc.analyzeSMC(candles);

        const prompt = `Analyze ${coin} on ${timeframe} for FUTURES TRADING.
        Current Price: $${currentPrice}, RSI: ${rsi}, EMA(50): ${ema}
        Resistance: $${marketSMC.resistance}, Support: $${marketSMC.support}
        Bullish FVG: ${marketSMC.bullishFVG}, Bearish FVG: ${marketSMC.bearishFVG}

        Provide a VERY SHORT analysis using Sinhala mixed with English trading terms.
        Format strictly like this:
        📌 Market Status: (Trend relative to EMA, and RSI meaning)
        🤖 AI Decision: (LONG, SHORT, or WAIT)
        🛡️ Confidence: (e.g., 85%) & Risk Level
        🎯 Trade Setup: Entry, TP, Strict SL
        💡 Trade Management (DCA vs SL): (If moving towards SL, mention DCA at FVG/Support or early exit).

        IMPORTANT: At the very end, output exactly:
        [TARGETS|ENTRY:number|TP:number|SL:number]`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const aiResponse = aiRes.data.choices[0].message.content;

        const outMsg = `
╔═══════════════════════════╗
║ 🔴 *FUTURES TRADE ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe}
💲 *Current Price:* $${currentPrice}

${aiResponse}

> 📌 *මෙම Trade එක Track කිරීමට .track ලෙස Reply කරන්න.*`;
        
        await reply(outMsg);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ================== TRACK COMMAND ==================
cmd({
    pattern: "track",
    desc: "Save and track a crypto trade",
    category: "crypto",
    react: "🎯",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        if (!m.quoted) return await reply('❌ කරුණාකර AI එකෙන් දුන්න Analysis මැසේජ් එකට Reply කරමින් .track ලෙස යවන්න.');
        
        const quotedText = m.quoted.conversation || m.quoted.extendedTextMessage?.text || m.quoted.text || m.quoted.body || "";
        if (!quotedText) return await reply('❌ Quoted මැසේජ් එක කියවීමට නොහැක.');

        const coinMatch = quotedText.match(/🪙 \*Coin:\* ([A-Z]+)/);
        if (!coinMatch) return await reply('❌ මෙය නිවැරදි Analysis පණිවිඩයක් නොවේ.');
        const coin = coinMatch[1] + 'USDT';
        const type = quotedText.includes('SPOT') ? 'spot' : 'future';

        const targetMatch = quotedText.match(/\[TARGETS\|ENTRY:\s*([0-9.]+)\s*\|TP:\s*([0-9.]+)\s*\|SL:\s*([0-9.]+)\s*\]/);
        
        if (!targetMatch) return await reply('❌ AI එක විසින් Entry/TP/SL දත්ත ලබා දී නැත.');

        const entry = parseFloat(targetMatch[1]);
        const tp = parseFloat(targetMatch[2]);
        const sl = parseFloat(targetMatch[3]);

        await db.saveTrade({
            userJid: m.sender,
            coin: coin,
            type: type,
            entry: entry,
            tp: tp,
            sl: sl
        });

        await reply(`✅ *${coin}* Trade එක සාර්ථකව Track කිරීම ආරම්භ කළා!\n\n🎯 *Entry:* $${entry}\n💰 *TP:* $${tp}\n🛑 *SL:* $${sl}\n\n(Trade එකේ තත්වය වෙනස් වූ විට මම ඔබව දැනුවත් කරමි)`);
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
        await reply('❌ Error: ' + e.message);
    }
});
