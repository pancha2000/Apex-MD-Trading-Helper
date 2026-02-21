const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

// ================== SPOT COMMAND (THE ULTIMATE AI) ==================
cmd({
    pattern: "spot",
    desc: "Ultimate Spot AI with Whales, Patterns & MTF",
    category: "crypto",
    react: "🟢",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n*උදා:* ${config.PREFIX}spot BTC 1d`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key එක නැහැ!');
        
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        let timeframe = args[1] ? args[1].toLowerCase() : '1d'; 

        await m.react('⏳');
        await reply(`⏳ *Binance දත්ත, Order Books සහ Global Sentiment විශ්ලේෂණය කරමින් පවතී...*`);

        // දත්ත ලබාගැනීම
        const currentCandles = await binance.getKlineData(coin, timeframe);
        const tf4hCandles = await binance.getKlineData(coin, '4h', 60);
        const tf1dCandles = await binance.getKlineData(coin, '1d', 60);
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();

        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        // Indicators
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema4H = indicators.calculateEMA(tf4hCandles);
        const ema1D = indicators.calculateEMA(tf1dCandles);
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const candlePattern = indicators.checkCandlePattern(currentCandles);
        const marketSMC = smc.analyzeSMC(currentCandles);

        const prompt = `You are a Master Institutional Crypto Spot Trader. Analyze ${coin} for SPOT TRADING.
        Current Price: $${currentPrice}
        
        [MULTI-TIMEFRAME & SENTIMENT]
        - Entry TF (${timeframe}) EMA(50): $${emaCurrent}
        - 4H EMA(50): $${ema4H} | 1D EMA(50): $${ema1D}
        - Global Fear & Greed Index: ${fng}

        [ORDER FLOW & PATTERNS]
        - Total Buy Volume (Bids): $${orderBook.totalBids}
        - Total Sell Volume (Asks): $${orderBook.totalAsks}
        - Latest Candlestick Pattern: ${candlePattern}

        [INDICATORS & SMC]
        - RSI: ${rsi} | Divergence: ${divergence}
        - ATR (Volatility): ${atr}
        - Resistance: $${marketSMC.resistance} | Support: $${marketSMC.support}
        - Bullish FVG: ${marketSMC.bullishFVG} | Bearish FVG: ${marketSMC.bearishFVG}
        - Fibonacci Golden Zone: $${marketSMC.fib618} - $${marketSMC.fib786}

        Provide a HIGHLY PROFESSIONAL, short analysis using Sinhala mixed with English trading terms.
        Format strictly like this:
        📌 Market Overview: (Combine MTF Trend, Fear&Greed, and Whale Order Book status)
        📉 Price Action & Momentum: (Mention Candle Pattern, Divergence and RSI)
        🤖 AI Decision: (BUY, HOLD, or WAIT - base this on Confluence)
        🛡️ Confidence: (e.g., 90%)
        🎯 Spot Targets: 
           - Entry Zone: (Precise accumulation zone based on Fib/Support and Whale Orders)
           - TP: (Target based on Resistance/FVG)
           - SL: (Invalidation point using ATR)
        🧮 Portfolio Risk: (Suggest exactly how much % of portfolio to allocate).

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
║  🟢 *PRO SPOT ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe} (MTF Synced)
💲 *Current Price:* $${currentPrice}

${aiResponse}

> 📌 *Track කිරීමට .track ලෙස Reply කරන්න.*`;
        
        await reply(outMsg);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ================== FUTURES COMMAND (THE ULTIMATE AI) ==================
cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Ultimate Futures AI with Whales, Patterns & MTF",
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
        await reply(`⏳ *Binance දත්ත, Order Books සහ Global Sentiment විශ්ලේෂණය කරමින් පවතී...*`);

        // දත්ත ලබාගැනීම
        const currentCandles = await binance.getKlineData(coin, timeframe);
        const hourlyCandles = await binance.getKlineData(coin, '1h', 60); 
        const macroCandles = await binance.getKlineData(coin, '4h', 60);  
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();

        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        // Indicators
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema1H = indicators.calculateEMA(hourlyCandles);
        const ema4H = indicators.calculateEMA(macroCandles);
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const candlePattern = indicators.checkCandlePattern(currentCandles);
        const marketSMC = smc.analyzeSMC(currentCandles);

        const prompt = `You are a Master Institutional Crypto Trader. Analyze ${coin} for FUTURES TRADING.
        Current Price: $${currentPrice}
        
        [MULTI-TIMEFRAME & SENTIMENT]
        - Entry TF (${timeframe}) EMA(50): $${emaCurrent}
        - 1H EMA(50): $${ema1H} | 4H EMA(50): $${ema4H}
        - Global Fear & Greed Index: ${fng}

        [ORDER FLOW & PATTERNS]
        - Total Buy Volume (Bids): $${orderBook.totalBids}
        - Total Sell Volume (Asks): $${orderBook.totalAsks}
        - Latest Candlestick Pattern: ${candlePattern}

        [INDICATORS & SMC]
        - RSI: ${rsi} | Divergence: ${divergence}
        - ATR (Volatility): ${atr}
        - Resistance: $${marketSMC.resistance} | Support: $${marketSMC.support}
        - Bullish FVG: ${marketSMC.bullishFVG} | Bearish FVG: ${marketSMC.bearishFVG}
        - Fibonacci Golden Zone: $${marketSMC.fib618} - $${marketSMC.fib786}

        Provide a HIGHLY PROFESSIONAL, short analysis using Sinhala mixed with English trading terms.
        Format strictly like this:
        📌 Market Overview: (Combine MTF Trend, Fear&Greed, and Whale Order Book status)
        📉 Price Action & Momentum: (Mention Candle Pattern, Divergence and RSI)
        🤖 AI Decision: (LONG, SHORT, or WAIT - base this on Confluence)
        🛡️ Confidence: (e.g., 90%)
        🎯 Trade Setup: 
           - Entry: (Precise sniper entry based on Fib/FVG and Whale Support/Resistance)
           - TP: (Target based on Resistance/Support)
           - SL: (Safe Stop Loss using ATR)
        🧮 Risk Management: (Suggest exactly how much margin % to use and maximum leverage).

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
║ 🔴 *PRO FUTURES ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe} (Synced with 1H & 4H)
💲 *Current Price:* $${currentPrice}

${aiResponse}

> 📌 *Track කිරීමට .track ලෙස Reply කරන්න.*`;
        
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
