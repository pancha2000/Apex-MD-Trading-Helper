const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database'); // අලුතින් හැදූ DB ෆන්ක්ෂන්ස්

// --- BINANCE API HELPER ---
async function getKlineData(coin, timeframe) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=5`;
    const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': config.BINANCE_API } });
    return res.data;
}

function formatCandles(candles) {
    return candles.map((c, i) => `Candle ${i + 1}: Open=$${parseFloat(c[1]).toFixed(2)}, High=$${parseFloat(c[2]).toFixed(2)}, Low=$${parseFloat(c[3]).toFixed(2)}, Close=$${parseFloat(c[4]).toFixed(2)}, Vol=${parseFloat(c[5]).toFixed(2)}`).join('\n');
}

// ================== SPOT COMMAND ==================
cmd({
    pattern: "spot",
    desc: "Spot Trading Analysis",
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
        await reply(`⏳ *Binance (${timeframe}) දත්ත ලබා ගනිමින් Spot Analysis සිදුකරමින් පවතී...*`);

        const candles = await getKlineData(coin, timeframe);
        const candleText = formatCandles(candles);
        const currentPrice = parseFloat(candles[4][4]).toFixed(2); 

        const prompt = `You are an expert Crypto Spot Trader. Analyze the following last 5 candlestick data for ${coin} on a ${timeframe} timeframe:
        ${candleText}\nCurrent Price: $${currentPrice}

        Provide a professional analysis in Sinhala focusing on:
        1. Overall Trend
        2. Best DCA / Spot Buy Zones
        3. Major Support and Resistance
        4. Long-term hold viability
        
        IMPORTANT: At the very end of your response, strictly output this exact format with your estimated numbers (do not add anything after it):
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

> 📌 *මෙම Trade එක Track කිරීමට අවශ්‍ය නම්, මෙම පණිවිඩයට Reply කරමින් .track ලෙස යවන්න.*`;
        
        await reply(outMsg);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ================== FUTURES COMMAND ==================
cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Futures Trading Analysis",
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
        await reply(`⏳ *Binance (${timeframe}) දත්ත ලබා ගනිමින් Futures Analysis සිදුකරමින් පවතී...*`);

        const candles = await getKlineData(coin, timeframe);
        const candleText = formatCandles(candles);
        const currentPrice = parseFloat(candles[4][4]).toFixed(2);

        const prompt = `You are an expert Crypto Futures Trader. Analyze the following last 5 candlestick data for ${coin} on a ${timeframe} timeframe:
        ${candleText}\nCurrent Price: $${currentPrice}

        Provide a professional analysis in Sinhala focusing on:
        1. Market Trend & Momentum
        2. Best Entry Points
        3. Strict Stop-Loss and Take-Profit
        4. Leverage advice
        
        IMPORTANT: At the very end of your response, strictly output this exact format with your estimated numbers (do not add anything after it):
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

> 📌 *මෙම Trade එක Track කිරීමට අවශ්‍ය නම්, මෙම පණිවිඩයට Reply කරමින් .track ලෙස යවන්න.*`;
        
        await reply(outMsg);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ================== TRACK COMMAND (NEW) ==================
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
        
        const quotedText = m.quoted.text || m.quoted.body;
        
        // Coin එක හොයාගැනීම
        const coinMatch = quotedText.match(/🪙 \*Coin:\* ([A-Z]+)/);
        if (!coinMatch) return await reply('❌ මෙය නිවැරදි Analysis පණිවිඩයක් නොවේ.');
        const coin = coinMatch[1] + 'USDT';
        
        // Trading Type එක හොයාගැනීම
        const type = quotedText.includes('SPOT') ? 'spot' : 'future';

        // Hidden Targets ටික අල්ලගැනීම (Regex)
        const targetMatch = quotedText.match(/\[TARGETS\|ENTRY:([0-9.]+)\|TP:([0-9.]+)\|SL:([0-9.]+)\]/);
        if (!targetMatch) return await reply('❌ AI එක විසින් Entry/TP/SL දත්ත ලබා දී නැත. වෙනත් Timeframe එකක් උත්සාහ කරන්න.');

        const entry = parseFloat(targetMatch[1]);
        const tp = parseFloat(targetMatch[2]);
        const sl = parseFloat(targetMatch[3]);

        // Database එකට Save කිරීම
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
