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
    desc: "Ultimate Spot AI with Multi-TP, Smart SL & RRR",
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
        await reply(`⏳ *Advanced Spot විශ්ලේෂණය ආරම්භ කෙරේ...*`);

        const currentCandles = await binance.getKlineData(coin, timeframe);
        const tf4hCandles = await binance.getKlineData(coin, '4h', 60);
        const tf1dCandles = await binance.getKlineData(coin, '1d', 60);
        
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();
        const news = await binance.getNewsHeadlines();

        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema4H = indicators.calculateEMA(tf4hCandles);
        const ema1D = indicators.calculateEMA(tf1dCandles);
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const candlePattern = indicators.checkCandlePattern(currentCandles);
        const poc = indicators.calculatePOC(currentCandles);
        const marketSMC = smc.analyzeSMC(currentCandles);

        // 🧮 100% Deterministic Math for SPOT (Long Only)
        const atrVal = parseFloat(atr);
        const fib618 = parseFloat(marketSMC.fib618);
        const res = parseFloat(marketSMC.resistance);
        const swingLow = parseFloat(marketSMC.swingLow);
        const ext1618 = parseFloat(marketSMC.ext1618);
        const ext2618 = parseFloat(marketSMC.ext2618);

        const spotEntry = fib618.toFixed(2);
        const spotTP1 = res.toFixed(2); // Safe TP
        const spotTP2 = ext1618.toFixed(2); // Main TP
        const spotTP3 = ext2618.toFixed(2); // Moon TP
        const spotSL = (swingLow - (atrVal * 1.5)).toFixed(2); // Smart SL (Swing Low - 1.5 ATR)

        // Risk to Reward Ratio Calculation
        const risk = Math.max(parseFloat(spotEntry) - parseFloat(spotSL), 0.0001);
        const reward = parseFloat(spotTP2) - parseFloat(spotEntry);
        const rrr = (reward / risk).toFixed(2);

        const prompt = `You are a Master Institutional Crypto Spot Trader. Analyze ${coin} for SPOT TRADING.
        Current Price: $${currentPrice}
        
        [DATA FEED]
        - MTF EMA(50): ${timeframe}=$${emaCurrent}, 4H=$${ema4H}, 1D=$${ema1D}
        - Sentiment: F&G Index=${fng} | News=${news}
        - Order Flow: Bids=$${orderBook.totalBids}, Asks=$${orderBook.totalAsks} | POC=$${poc}
        - TA: RSI=${rsi} | ATR=${atr} | Pattern=${candlePattern} | Divergence=${divergence}

        CRITICAL MATH RULES:
        If you decide to issue a BUY signal, you MUST output exactly these numbers:
        entry: "${spotEntry}", tp1: "${spotTP1}", tp2: "${spotTP2}", tp3: "${spotTP3}", sl: "${spotSL}", rrr: "1:${rrr}"

        CRITICAL LANGUAGE RULES:
        1. Write explanations STRICTLY using the Sinhala alphabet/script (සිංහල අකුරෙන්). Example: "වෙළඳපොළ ඉහළට ගමන් කරයි".
        2. DO NOT use Singlish under any circumstances.
        3. Keep technical trading terms EXACTLY in English (e.g., Trend, Momentum, Support, Resistance).

        You MUST respond ONLY with a valid JSON object.
        {
          "direction": "BUY or HOLD or WAIT",
          "emoji": "🟢 for buy, ⚪ for hold/wait",
          "entry": "Strictly the number provided",
          "tp1": "Strictly the number provided",
          "tp2": "Strictly the number provided",
          "tp3": "Strictly the number provided",
          "sl": "Strictly the number provided",
          "rrr": "Strictly the RRR provided",
          "allocation": "e.g., 5% to 10%",
          "confidence": "e.g., 85%",
          "trend": "Explain in proper Sinhala alphabet (සිංහල අකුරෙන්).",
          "sentiment": "Explain in proper Sinhala alphabet (සිංහල අකුරෙන්).",
          "momentum": "Explain in proper Sinhala alphabet (සිංහල අකුරෙන්)."
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
🎯 Take Profits (TP):
   ▪️ TP 1 (Safe): $${data.tp1}
   ▪️ TP 2 (Main): $${data.tp2}
   ▪️ TP 3 (Moon): $${data.tp3}
🛡️ Stop Loss (SL): $${data.sl} (Smart ATR SL)

*⚖️ Risk Management*
Risk/Reward Ratio (RRR): ${data.rrr}
Portfolio Allocation: ${data.allocation}
Confidence: ${data.confidence} 🔥

*📊 Market Analysis*

Trend: ${data.trend}

Sentiment: ${data.sentiment}

Momentum: ${data.momentum}

⚡ සටහන: මෙය මූල්‍ය උපදේශනයක් නොවන අතර, සැමවිටම ඔබේ අවදානම කළමනාකරණය කරගන්න.

📌 Track කිරීමට .track ලෙස Reply කරන්න.
[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`;
        
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
    desc: "Ultimate Futures AI with Multi-TP, Smart SL & RRR",
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
        await reply(`⏳ *Advanced Futures විශ්ලේෂණය ආරම්භ කෙරේ...*`);

        const currentCandles = await binance.getKlineData(coin, timeframe);
        const hourlyCandles = await binance.getKlineData(coin, '1h', 60); 
        const macroCandles = await binance.getKlineData(coin, '4h', 60);  
        
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();
        const futuresData = await binance.getFuturesData(coin);
        const news = await binance.getNewsHeadlines();

        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema1H = indicators.calculateEMA(hourlyCandles);
        const ema4H = indicators.calculateEMA(macroCandles);
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const candlePattern = indicators.checkCandlePattern(currentCandles);
        const poc = indicators.calculatePOC(currentCandles);
        const marketSMC = smc.analyzeSMC(currentCandles);

        // 🧮 100% Deterministic Math for FUTURES 
        const atrVal = parseFloat(atr);
        const fib618 = parseFloat(marketSMC.fib618);
        const res = parseFloat(marketSMC.resistance);
        const sup = parseFloat(marketSMC.support);
        const swingHigh = parseFloat(marketSMC.swingHigh);
        const swingLow = parseFloat(marketSMC.swingLow);
        const ext1618 = parseFloat(marketSMC.ext1618);
        const ext2618 = parseFloat(marketSMC.ext2618);
        const extMinus1618 = parseFloat(marketSMC.extMinus1618);

        // LONG Calculations
        const longEntry = fib618.toFixed(2);
        const longTP1 = res.toFixed(2);
        const longTP2 = ext1618.toFixed(2);
        const longTP3 = ext2618.toFixed(2);
        const longSL = (swingLow - (atrVal * 1.5)).toFixed(2);
        const longRisk = Math.max(parseFloat(longEntry) - parseFloat(longSL), 0.0001);
        const longReward = parseFloat(longTP2) - parseFloat(longEntry);
        const rrrLong = (longReward / longRisk).toFixed(2);

        // SHORT Calculations
        const shortEntry = res.toFixed(2); 
        const shortTP1 = fib618.toFixed(2);
        const shortTP2 = sup.toFixed(2);
        const shortTP3 = extMinus1618.toFixed(2);
        const shortSL = (swingHigh + (atrVal * 1.5)).toFixed(2);
        const shortRisk = Math.max(parseFloat(shortSL) - parseFloat(shortEntry), 0.0001);
        const shortReward = parseFloat(shortEntry) - parseFloat(shortTP2);
        const rrrShort = (shortReward / shortRisk).toFixed(2);

        const prompt = `You are a Master Institutional Crypto AI. Analyze ${coin} for FUTURES TRADING.
        Current Price: $${currentPrice}
        
        [DATA FEED]
        - MTF EMA(50): ${timeframe}=$${emaCurrent}, 1H=$${ema1H}, 4H=$${ema4H}
        - Sentiment: F&G Index=${fng} | News=${news}
        - Order Flow: Bids=$${orderBook.totalBids}, Asks=$${orderBook.totalAsks} | POC=$${poc}

        CRITICAL MATH RULES:
        Based on your analysis, if you decide to go LONG, you MUST output exactly:
        entry: "${longEntry}", tp1: "${longTP1}", tp2: "${longTP2}", tp3: "${longTP3}", sl: "${longSL}", rrr: "1:${rrrLong}"
        
        If you decide to go SHORT, you MUST output exactly:
        entry: "${shortEntry}", tp1: "${shortTP1}", tp2: "${shortTP2}", tp3: "${shortTP3}", sl: "${shortSL}", rrr: "1:${rrrShort}"

        CRITICAL LANGUAGE RULES:
        1. Write explanations STRICTLY using the Sinhala alphabet/script (සිංහල අකුරෙන්). Example: "වෙළඳපොළ ඉහළට ගමන් කරයි".
        2. DO NOT use Singlish under any circumstances.
        3. Keep technical trading terms EXACTLY in English (e.g., Trend, Momentum, Support, Resistance).

        You MUST respond ONLY with a valid JSON object.
        {
          "direction": "LONG (Buy) or SHORT (Sell) or WAIT (Neutral)",
          "emoji": "🟢 for long, 🔴 for short, ⚪ for wait",
          "entry": "Strictly the number provided",
          "tp1": "Strictly the number provided",
          "tp2": "Strictly the number provided",
          "tp3": "Strictly the number provided",
          "sl": "Strictly the number provided",
          "rrr": "Strictly the RRR provided",
          "leverage": "e.g., 5x (Isolated)",
          "margin": "e.g., 3%",
          "confidence": "e.g., 85%",
          "trend": "Explain in proper Sinhala alphabet (සිංහල අකුරෙන්).",
          "sentiment": "Explain in proper Sinhala alphabet (සිංහල අකුරෙන්).",
          "momentum": "Explain in proper Sinhala alphabet (සිංහල අකුරෙන්)."
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
🎯 Take Profits (TP):
   ▪️ TP 1 (Safe): $${data.tp1}
   ▪️ TP 2 (Main): $${data.tp2}
   ▪️ TP 3 (Moon): $${data.tp3}
🛡️ Stop Loss (SL): $${data.sl} (Smart ATR SL)

*⚖️ Risk Management*
Risk/Reward Ratio (RRR): ${data.rrr}
Leverage: ${data.leverage}
Margin Usage: ${data.margin}
Confidence: ${data.confidence} 🔥

*📊 Market Analysis*

Trend: ${data.trend}

Sentiment: ${data.sentiment}

Momentum: ${data.momentum}

⚡ සටහන: මෙය මූල්‍ය උපදේශනයක් නොවන අතර, සැමවිටම ඔබේ අවදානම කළමනාකරණය කරගන්න.

📌 Track කිරීමට .track ලෙස Reply කරන්න.
[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`;
        
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
        await reply(`✅ *${coin}* Trade එක සාර්ථකව Track කිරීම ආරම්භ කළා!\n\n🎯 *Entry:* $${entry}\n💰 *TP (Main):* $${tp}\n🛑 *SL:* $${sl}`);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
