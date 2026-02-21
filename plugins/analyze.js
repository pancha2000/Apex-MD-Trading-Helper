const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');

// Modular Architecture Imports
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
        await reply(`⏳ *Advanced AI විශ්ලේෂණය ආරම්භ කෙරේ...*`);

        // දත්ත ලබාගැනීම
        const currentCandles = await binance.getKlineData(coin, timeframe);
        const tf4hCandles = await binance.getKlineData(coin, '4h', 60);
        const tf1dCandles = await binance.getKlineData(coin, '1d', 60);
        
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();
        const news = await binance.getNewsHeadlines();

        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        // Indicators & SMC
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema4H = indicators.calculateEMA(tf4hCandles);
        const ema1D = indicators.calculateEMA(tf1dCandles);
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const candlePattern = indicators.checkCandlePattern(currentCandles);
        const poc = indicators.calculatePOC(currentCandles);
        const marketSMC = smc.analyzeSMC(currentCandles);

        const prompt = `You are a Master Institutional Crypto Spot Trader. Analyze ${coin} for SPOT TRADING.
        Current Price: $${currentPrice}
        
        [DATA FEED]
        - MTF EMA(50): ${timeframe}=$${emaCurrent}, 4H=$${ema4H}, 1D=$${ema1D}
        - Sentiment: F&G Index=${fng} | News=${news}
        - Order Flow: Bids=$${orderBook.totalBids}, Asks=$${orderBook.totalAsks} | POC=$${poc}
        - TA: RSI=${rsi} | ATR=${atr} | Pattern=${candlePattern} | Divergence=${divergence}
        - SMC: Res=$${marketSMC.resistance} | Sup=$${marketSMC.support} | Fib 0.618=$${marketSMC.fib618}

        CRITICAL LANGUAGE RULES:
        1. Write the explanation STRICTLY in proper Sinhala script (සිංහල අකුරෙන්). Do NOT use Singlish.
        2. DO NOT translate technical trading terms. Keep terms like Trend, Momentum, Support, Resistance, Bullish, Bearish, FVG, Order Book, Long, Short EXACTLY in English.

        You MUST respond ONLY with a valid JSON object. Do not add markdown blocks.
        Format strictly like this:
        {
          "direction": "BUY or HOLD or WAIT",
          "emoji": "🟢 for buy, ⚪ for hold/wait",
          "entry": "precise number",
          "tp": "precise number",
          "sl": "precise number using ATR",
          "allocation": "e.g., 5% to 10%",
          "confidence": "e.g., 85%",
          "trend": "Short Sinhala sentence explaining MTF and EMA trend (Keep trading words in English).",
          "sentiment": "Short Sinhala sentence explaining F&G, Orderbook, and News (Keep trading words in English).",
          "momentum": "Short Sinhala sentence explaining RSI, Pattern, and Divergence (Keep trading words in English)."
        }`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        let aiResponse = aiRes.data.choices[0].message.content;
        
        let jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI Format Error");
        let data = JSON.parse(jsonMatch[0]);

        const outMsg = `
╔═══════════════════════════╗
║  🟢 *PRO SPOT ANALYSIS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Timeframe: ${timeframe} | 4H | 1D (Multi-Timeframe Synced)

 *🎯 Trade Setup* 📉 Direction: ${data.direction} ${data.emoji}

📍 Entry Price: $${data.entry} 
🎯 Take Profit (TP): $${data.tp}
🛡️ Stop Loss (SL): $${data.sl} 

*⚖️ Risk Management*

Portfolio Allocation: ${data.allocation}
Confidence: ${data.confidence} 🔥

*📊 Market Analysis*

Trend: ${data.trend}

Sentiment: ${data.sentiment}

Momentum: ${data.momentum}

⚡ සටහන: මෙය මූල්‍ය උපදේශනයක් නොවන අතර, සැමවිටම ඔබේ අවදානම කළමනාකරණය කරගන්න.

📌 Track කිරීමට .track ලෙස Reply කරන්න.
[TARGETS|ENTRY:${data.entry.replace(/,/g, '')}|TP:${data.tp.replace(/,/g, '')}|SL:${data.sl.replace(/,/g, '')}]`;
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { 
        await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්. නැවත උත්සාහ කරන්න.'); 
        console.log(e); 
    }
});

// ================== FUTURES COMMAND (THE ULTIMATE AI) ==================
cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Ultimate Futures AI with Flawless Formatting",
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
        await reply(`⏳ *Advanced AI විශ්ලේෂණය ආරම්භ කෙරේ...*`);

        // දත්ත ලබාගැනීම
        const currentCandles = await binance.getKlineData(coin, timeframe);
        const hourlyCandles = await binance.getKlineData(coin, '1h', 60); 
        const macroCandles = await binance.getKlineData(coin, '4h', 60);  
        
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();
        const futuresData = await binance.getFuturesData(coin);
        const news = await binance.getNewsHeadlines();

        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        // Indicators & SMC
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema1H = indicators.calculateEMA(hourlyCandles);
        const ema4H = indicators.calculateEMA(macroCandles);
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const candlePattern = indicators.checkCandlePattern(currentCandles);
        const poc = indicators.calculatePOC(currentCandles);
        const marketSMC = smc.analyzeSMC(currentCandles);

        const prompt = `You are a Master Institutional Crypto AI. Analyze ${coin} for FUTURES TRADING.
        Current Price: $${currentPrice}
        
        [DATA FEED]
        - MTF EMA(50): ${timeframe}=$${emaCurrent}, 1H=$${ema1H}, 4H=$${ema4H}
        - Sentiment: F&G Index=${fng} | News=${news}
        - Order Flow: Bids=$${orderBook.totalBids}, Asks=$${orderBook.totalAsks} | POC=$${poc}
        - Derivatives: Funding Rate=${futuresData.fundingRate} | OI=${futuresData.openInterest}
        - TA: RSI=${rsi} | ATR=${atr} | Pattern=${candlePattern} | Divergence=${divergence}
        - SMC: Res=$${marketSMC.resistance} | Sup=$${marketSMC.support} | Fib 0.618=$${marketSMC.fib618}

        CRITICAL LANGUAGE RULES:
        1. Write the explanation STRICTLY in proper Sinhala script (සිංහල අකුරෙන්). Do NOT use Singlish.
        2. DO NOT translate technical trading terms. Keep terms like Trend, Momentum, Support, Resistance, Bullish, Bearish, FVG, Order Book, Long, Short EXACTLY in English.

        You MUST respond ONLY with a valid JSON object. Do not add markdown blocks.
        Format strictly like this:
        {
          "direction": "LONG (Buy) or SHORT (Sell) or WAIT (Neutral)",
          "emoji": "🟢 for long, 🔴 for short, ⚪ for wait",
          "entry": "precise number",
          "tp": "precise number",
          "sl": "precise number using ATR",
          "leverage": "e.g., 5x (Isolated)",
          "margin": "e.g., 3%",
          "confidence": "e.g., 85%",
          "trend": "Short Sinhala sentence explaining MTF and EMA trend (Keep trading words in English).",
          "sentiment": "Short Sinhala sentence explaining F&G, Orderbook, and News (Keep trading words in English).",
          "momentum": "Short Sinhala sentence explaining RSI, Pattern, and Divergence (Keep trading words in English)."
        }`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        let aiResponse = aiRes.data.choices[0].message.content;
        
        let jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI Format Error");
        let data = JSON.parse(jsonMatch[0]);

        const outMsg = `
╔═══════════════════════════╗
║ 🔴 *PRO FUTURES ANALYSIS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Timeframe: ${timeframe} | 1H | 4H (Multi-Timeframe Synced)

 *🎯 Trade Setup* 📉 Direction: ${data.direction} ${data.emoji}

📍 Entry Price: $${data.entry} 
🎯 Take Profit (TP): $${data.tp}
🛡️ Stop Loss (SL): $${data.sl} 

*⚖️ Risk Management*

Leverage: ${data.leverage}
Margin Usage: ${data.margin}
Confidence: ${data.confidence} 🔥

*📊 Market Analysis*

Trend: ${data.trend}

Sentiment: ${data.sentiment}

Momentum: ${data.momentum}

⚡ සටහන: මෙය මූල්‍ය උපදේශනයක් නොවන අතර, සැමවිටම ඔබේ අවදානම කළමනාකරණය කරගන්න.

📌 Track කිරීමට .track ලෙස Reply කරන්න.
[TARGETS|ENTRY:${data.entry.replace(/,/g, '')}|TP:${data.tp.replace(/,/g, '')}|SL:${data.sl.replace(/,/g, '')}]`;
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { 
        await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්. නැවත උත්සාහ කරන්න.'); 
        console.log(e); 
    }
});

// ================== TRACK COMMAND (කිසිම වෙනසක් නැත) ==================
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

        const coinMatch = quotedText.match(/🪙 Coin: #([A-Z]+)/);
        if (!coinMatch) return await reply('❌ මෙය නිවැරදි Analysis පණිවිඩයක් නොවේ.');
        const coin = coinMatch[1] + 'USDT';
        const type = quotedText.includes('SPOT') ? 'spot' : 'future';

        const targetMatch = quotedText.match(/\[TARGETS\|ENTRY:\s*([0-9.]+)\s*\|TP:\s*([0-9.]+)\s*\|SL:\s*([0-9.]+)\s*\]/);
        if (!targetMatch) return await reply('❌ AI එක විසින් Entry/TP/SL දත්ත ලබා දී නැත.');

        const entry = parseFloat(targetMatch[1]), tp = parseFloat(targetMatch[2]), sl = parseFloat(targetMatch[3]);

        await db.saveTrade({ userJid: m.sender, coin: coin, type: type, entry: entry, tp: tp, sl: sl });
        await reply(`✅ *${coin}* Trade එක සාර්ථකව Track කිරීම ආරම්භ කළා!\n\n🎯 *Entry:* $${entry}\n💰 *TP:* $${tp}\n🛑 *SL:* $${sl}`);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
