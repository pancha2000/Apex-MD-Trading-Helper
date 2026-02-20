const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

cmd({
    pattern: "analyze",
    alias: ["crypto", "market", "trade"],
    desc: "Analyze crypto market using Binance & Gemini AI",
    category: "crypto",
    react: "📈",
    filename: __filename
},
async (conn, mek, m, { reply, text, args }) => {
    try {
        if (!text) {
            return await reply('❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n\n*උදාහරණ:* .analyze BTC');
        }

        if (!config.GEMINI_API) {
            return await reply('❌ GEMINI_API key එක config.env ෆයිල් එකේ නැහැ!');
        }

        await m.react('⏳');
        await reply('⏳ *Binance දත්ත ලබා ගනිමින් සහ AI හරහා විශ්ලේෂණය කරමින් පවතී...*');

        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';

        // Binance data via proxy
        const binanceUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${coin}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(binanceUrl)}`;

        const res = await axios.get(proxyUrl);
        const data = res.data;

        const price = parseFloat(data.lastPrice).toFixed(2);
        const change = parseFloat(data.priceChangePercent).toFixed(2);
        const high = parseFloat(data.highPrice).toFixed(2);
        const low = parseFloat(data.lowPrice).toFixed(2);
        const vol = parseFloat(data.volume).toFixed(2);

        // AI Prompt
        const prompt = `You are an expert crypto trading analyst. Analyze the following 24-hour market data for ${coin} from Binance:
        - Current Price: $${price}
        - 24h Price Change: ${change}%
        - 24h High: $${high}
        - 24h Low: $${low}
        - 24h Volume: ${vol}

        Please provide a short, highly professional market analysis for day trading. Include:
        1. Current Market Trend (Bullish/Bearish/Neutral)
        2. Key Support & Resistance levels (estimate based on high/low)
        3. A short trading advice/strategy.
        Keep it clear, concise, and use emojis.
        IMPORTANT: Reply ONLY in Sinhala language. Add a disclaimer that this is not financial advice.`;

        // Gemini 1.5 Flash (0.24.1 compatible)
        const genAI = new GoogleGenerativeAI(config.GEMINI_API);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const aiResponse = result.response.text();

        const outMsg = `
╔═══════════════════════════╗
║   📈 *CRYPTO AI ANALYSIS* ║
╚═══════════════════════════╝

🪙 *Coin:* ${coin.replace('USDT', '')}
💲 *Current Price:* $${price}
📊 *24h Change:* ${change > 0 ? '🟢 +' : '🔴 '}${change}%
⬆️ *24h High:* $${high}
⬇️ *24h Low:* $${low}

🤖 *AI Market Analysis:*
${aiResponse}

> _Powered by Apex-MD-Trading-Helper_
`;
        await reply(outMsg);
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
        if (e.response && e.response.status === 404) {
            await reply(`❌ '${text}' යනු වලංගු Coin එකක් නොවේ. BTC, ETH, SOL වැනි නිවැරදි නමක් ලබා දෙන්න.`);
        } else {
            await reply('❌ Error: ' + (e.message || e.toString()));
        }
    }
});
