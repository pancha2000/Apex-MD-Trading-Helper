const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');

// --- BINANCE KLINE (CANDLESTICK) API HELPER FUNCTION ---
async function getKlineData(coin, timeframe) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=5`;
    const res = await axios.get(url, {
        headers: { 'X-MBX-APIKEY': config.BINANCE_API }
    });
    return res.data;
}

function formatCandles(candles) {
    return candles.map((c, i) => `Candle ${i + 1}: Open=$${parseFloat(c[1]).toFixed(2)}, High=$${parseFloat(c[2]).toFixed(2)}, Low=$${parseFloat(c[3]).toFixed(2)}, Close=$${parseFloat(c[4]).toFixed(2)}, Vol=${parseFloat(c[5]).toFixed(2)}`).join('\n');
}

// ================== SPOT TRADING COMMAND ==================
cmd({
    pattern: "spot",
    desc: "Spot Trading Analysis using Groq AI",
    category: "crypto",
    react: "🟢",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n\n*උදා:* ${config.PREFIX}spot BTC 4h`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key එක config.env ෆයිල් එකේ නැහැ!');
        
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        
        let timeframe = args[1] ? args[1].toLowerCase() : '1d'; 

        await m.react('⏳');
        await reply(`⏳ *Binance (${timeframe}) දත්ත ලබා ගනිමින් Spot Analysis සිදුකරමින් පවතී...*`);

        const candles = await getKlineData(coin, timeframe);
        const candleText = formatCandles(candles);
        const currentPrice = parseFloat(candles[4][4]).toFixed(2); 

        const prompt = `You are an expert Crypto Spot Trader. Analyze the following last 5 candlestick data for ${coin} on a ${timeframe} timeframe from Binance:
        
        ${candleText}
        Current Price: $${currentPrice}

        This is for SPOT TRADING. Please provide a highly professional analysis focusing on:
        1. Overall Trend (in this timeframe)
        2. Best DCA (Dollar Cost Averaging) / Spot Buy Zones
        3. Major Support and Resistance levels
        4. Long-term hold viability & Risk management.
        
        Keep it clear, concise, and use emojis. 
        IMPORTANT: Reply ONLY in Sinhala language. Add a disclaimer that this is not financial advice.`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, {
            headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' }
        });

        const aiResponse = aiRes.data.choices[0].message.content;

        const outMsg = `
╔═══════════════════════════╗
║  🟢 *SPOT TRADE ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe}
💲 *Current Price:* $${currentPrice}

${aiResponse}

> _APEX-MD Spot AI_`;
        
        await reply(outMsg);
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
        await reply('❌ Error: ' + (e.response?.data?.msg || e.response?.data?.error?.message || e.message));
    }
});

// ================== FUTURES TRADING COMMAND ==================
cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Futures Trading Analysis using Groq AI",
    category: "crypto",
    react: "🔴",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n\n*උදා:* ${config.PREFIX}future BTC 15m`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key එක config.env ෆයිල් එකේ නැහැ!');
        
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        
        let timeframe = args[1] ? args[1].toLowerCase() : '15m'; 

        await m.react('⏳');
        await reply(`⏳ *Binance (${timeframe}) දත්ත ලබා ගනිමින් Futures Analysis සිදුකරමින් පවතී...*`);

        const candles = await getKlineData(coin, timeframe);
        const candleText = formatCandles(candles);
        const currentPrice = parseFloat(candles[4][4]).toFixed(2);

        const prompt = `You are an expert Crypto Futures Trader & Scalper. Analyze the following last 5 candlestick data for ${coin} on a ${timeframe} timeframe from Binance:
        
        ${candleText}
        Current Price: $${currentPrice}

        This is for FUTURES TRADING. Please provide a highly professional analysis focusing on:
        1. Current Market Trend & Momentum (in this timeframe)
        2. Best Entry Points for Long (Buy) and Short (Sell)
        3. Strict Stop-Loss (SL) and Take-Profit (TP) targets
        4. Leverage advice and Liquidation risks.
        
        Keep it clear, concise, and use emojis. 
        IMPORTANT: Reply ONLY in Sinhala language. Add a disclaimer that this is not financial advice.`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, {
            headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' }
        });

        const aiResponse = aiRes.data.choices[0].message.content;

        const outMsg = `
╔═══════════════════════════╗
║ 🔴 *FUTURES TRADE ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe}
💲 *Current Price:* $${currentPrice}

${aiResponse}

> _APEX-MD Futures AI_`;
        
        await reply(outMsg);
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
        await reply('❌ Error: ' + (e.response?.data?.msg || e.response?.data?.error?.message || e.message));
    }
});
