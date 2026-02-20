const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');

cmd({
    pattern: "analyze",
    alias: ["crypto", "market", "trade"],
    desc: "Analyze crypto market using Binance & AI via Private Proxy",
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
            return await reply('❌ GEMINI_API key එක config.env ෆයිල් එකේ නැහැ! කරුණාකර එය ඇතුළත් කරන්න.');
        }

        await m.react('⏳');
        await reply('⏳ *Binance දත්ත ලබා ගනිමින් සහ AI හරහා විශ්ලේෂණය කරමින් පවතී...*');

        // User දෙන coin එක (උදා: btc) USDT එක්ක සම්බන්ධ කිරීම
        let coin = args[0].toUpperCase();
        if(!coin.endsWith('USDT')) coin += 'USDT';

        // 1. Binance API එකෙන් Live Data ගැනීම
        const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${coin}`;
        const res = await axios.get(url);
        const data = res.data;

        const price = parseFloat(data.lastPrice).toFixed(2);
        const change = parseFloat(data.priceChangePercent).toFixed(2);
        const high = parseFloat(data.highPrice).toFixed(2);
        const low = parseFloat(data.lowPrice).toFixed(2);
        const vol = parseFloat(data.volume).toFixed(2);

        // 2. AI එක සඳහා Prompt එක සැකසීම
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

        // 3. ඔයාගේ Cloudflare Private Proxy හරහා Gemini API වෙත Request එක යැවීම
        const proxyUrl = `https://patient-band-7ce9.cdilrukshi52.workers.dev/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API}`;
        
        const aiPayload = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        const aiRes = await axios.post(proxyUrl, aiPayload, {
            headers: { 'Content-Type': 'application/json' }
        });

        // Proxy එකෙන් එන ප්‍රතිචාරය (Response) ලබා ගැනීම
        const aiResponse = aiRes.data.candidates[0].content.parts[0].text;

        // 4. WhatsApp Message එක Format කිරීම
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
        if (e.response && e.response.status === 400 && !e.response.config.url.includes('workers.dev')) {
            await reply(`❌ '${text}' යනු වලංගු Coin එකක් නොවේ. කරුණාකර BTC, ETH, SOL වැනි නිවැරදි නමක් ලබා දෙන්න.`);
        } else {
            const errorMsg = e.response?.data?.error?.message || e.message;
            await reply('❌ AI Error: ' + errorMsg);
        }
    }
});
