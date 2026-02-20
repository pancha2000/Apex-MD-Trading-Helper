const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');

cmd({
    pattern: "analyze",
    alias: ["crypto", "market", "trade"],
    desc: "Analyze crypto market using Official Binance API & Groq AI",
    category: "crypto",
    react: "📈",
    filename: __filename
},
async (conn, mek, m, { reply, text, args }) => {
    try {
        if (!text) return await reply('❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n\n*උදාහරණ:* .analyze BTC');
        if (!config.GROQ_API) return await reply('❌ GROQ_API key එක config.env ෆයිල් එකේ නැහැ!');
        if (!config.BINANCE_API) return await reply('❌ BINANCE_API key එක config.env ෆයිල් එකේ නැහැ!');

        await m.react('⏳');
        await reply('⏳ *Binance දත්ත ලබා ගනිමින් සහ Llama 3 AI හරහා විශ්ලේෂණය කරමින් පවතී...*');

        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';

        // 1. Direct Binance API Call (Proxy ඉවත් කර ඇත, ඔයාගේ Key එක භාවිතා කරයි)
        const binanceUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${coin}`;
        const res = await axios.get(binanceUrl, {
            headers: {
                'Content-Type': 'application/json',
                'X-MBX-APIKEY': config.BINANCE_API
            }
        });
        const data = res.data;

        const price = parseFloat(data.lastPrice).toFixed(2);
        const change = parseFloat(data.priceChangePercent).toFixed(2);
        const high = parseFloat(data.highPrice).toFixed(2);
        const low = parseFloat(data.lowPrice).toFixed(2);
        const vol = parseFloat(data.volume).toFixed(2);

        // 2. AI Prompt
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

        // 3. Groq API Call (Llama 3)
        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiPayload = {
            model: "llama3-70b-8192", 
            messages: [{ role: "user", content: prompt }]
        };

        const aiRes = await axios.post(groqUrl, aiPayload, {
            headers: {
                'Authorization': `Bearer ${config.GROQ_API}`,
                'Content-Type': 'application/json'
            }
        });

        const aiResponse = aiRes.data.choices[0].message.content;

        // 4. Output Message
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
        if (e.response && e.response.status === 400 && e.config && e.config.url.includes('binance')) {
            await reply(`❌ '${text}' යනු වලංගු Coin එකක් නොවේ. BTC, ETH, SOL වැනි නිවැරදි නමක් ලබා දෙන්න.`);
        } else {
            await reply('❌ Error: ' + (e.response?.data?.error?.message || e.message));
        }
    }
});
