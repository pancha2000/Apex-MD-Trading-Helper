const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

// ================== SPOT COMMAND ==================
cmd({
    pattern: "spot",
    desc: "Ultimate Spot AI with ChoCH & Position Sizing",
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
        
        // Indicators
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema4H = indicators.calculateEMA(tf4hCandles);
        const ema1D = indicators.calculateEMA(tf1dCandles);
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const candlePattern = indicators.checkCandlePattern(currentCandles);
        const poc = indicators.calculatePOC(currentCandles);
        const macd = indicators.calculateMACD(currentCandles);
        
        // 🧠 Smart Money Concepts
        const marketSMC = smc.analyzeSMC(currentCandles);
        const sweep = marketSMC.sweep; // 👈 දැන් SMC එකෙන් ගන්නේ
        const choch = marketSMC.choch; // 👈 දැන් SMC එකෙන් ගන්නේ

        // 💰 User Margin
        const userMargin = await db.getMargin(m.sender) || 0;
        let marginInfo = userMargin > 0 ? `Your Available Margin: $${userMargin}` : "No margin set by user.";

        // Math
        const atrVal = parseFloat(atr);
        const fib618 = parseFloat(marketSMC.fib618);
        const res = parseFloat(marketSMC.resistance);
        const swingLow = parseFloat(marketSMC.swingLow);
        const ext1618 = parseFloat(marketSMC.ext1618);
        const ext2618 = parseFloat(marketSMC.ext2618);

        const spotEntry = fib618.toFixed(2);
        const spotTP1 = res.toFixed(2); 
        const spotTP2 = ext1618.toFixed(2);
        const spotTP3 = ext2618.toFixed(2);
        const spotSL = (swingLow - (atrVal * 1.5)).toFixed(2);

        const risk = Math.max(parseFloat(spotEntry) - parseFloat(spotSL), 0.0001);
        const reward = parseFloat(spotTP2) - parseFloat(spotEntry);
        const rrr = (reward / risk).toFixed(2);

        // 🧮 Spot Position Sizing (Risk 2%)
        let spotAlloc = "N/A";
        let riskAmount = "N/A";
        if (userMargin > 0) {
            let riskMoney = userMargin * 0.02; // 2% risk
            let slPercent = risk / parseFloat(spotEntry);
            let posSize = riskMoney / slPercent;
            spotAlloc = posSize > userMargin ? `Max $${userMargin} (Full Margin)` : `$${posSize.toFixed(2)}`;
            riskAmount = `$${riskMoney.toFixed(2)}`;
        }

        const prompt = `You are a Master Institutional Crypto Spot Trader. Analyze ${coin} for SPOT TRADING.
        Current Price: $${currentPrice}
        ${marginInfo}
        
        [DATA FEED]
        - MTF EMA(50): ${timeframe}=$${emaCurrent}, 4H=$${ema4H}, 1D=$${ema1D}
        - Sentiment: F&G Index=${fng} | News=${news}
        - Order Flow: Bids=$${orderBook.totalBids}, Asks=$${orderBook.totalAsks} | POC=$${poc}
        - TA: RSI=${rsi} | MACD=${macd} | Pattern=${candlePattern} | Divergence=${divergence}
        - Smart Money: ChoCH=${choch} | Liquidity Sweep=${sweep}

        CRITICAL MATH RULES:
        If BUY, you MUST output exactly:
        entry: "${spotEntry}", tp1: "${spotTP1}", tp2: "${spotTP2}", tp3: "${spotTP3}", sl: "${spotSL}", rrr: "1:${rrr}", allocation: "${spotAlloc}", riskAmt: "${riskAmount}"

        CRITICAL LANGUAGE RULES:
        1. Write explanations STRICTLY using the Sinhala alphabet.
        2. DO NOT use Singlish.
        3. Keep technical terms exactly in English.

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
          "allocation": "Strictly the allocation provided",
          "riskAmt": "Strictly the riskAmt provided",
          "confidence": "e.g., 85%",
          "trend": "Explain in proper Sinhala alphabet.",
          "sentiment": "Explain in proper Sinhala alphabet.",
          "momentum": "Explain in proper Sinhala alphabet."
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
🛡️ Stop Loss (SL): $${data.sl} 

*⚖️ Risk Management*
Risk/Reward (RRR): ${data.rrr}
💰 Investment to Deploy: ${data.allocation}
🛡️ Amount at Risk (2%): ${data.riskAmt}
Confidence: ${data.confidence} 🔥

*📊 Market Analysis*
Trend: ${data.trend}
Sentiment: ${data.sentiment}
Momentum: ${data.momentum}

⚡ සටහන: ඔබේ Margin එක .margin මගින් යාවත්කාලීන කරන්න.
📌 Track කිරීමට .track ලෙස Reply කරන්න.
[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`;
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්. නැවත උත්සාහ කරන්න.'); console.log(e); }
});

// ================== FUTURES COMMAND ==================
cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Ultimate Futures AI with Margin sizing",
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
        
        // Indicators
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema1H = indicators.calculateEMA(hourlyCandles);
        const ema4H = indicators.calculateEMA(macroCandles);
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const candlePattern = indicators.checkCandlePattern(currentCandles);
        const poc = indicators.calculatePOC(currentCandles);
        const macd = indicators.calculateMACD(currentCandles);
        
        // 🧠 Smart Money Concepts
        const marketSMC = smc.analyzeSMC(currentCandles);
        const sweep = marketSMC.sweep; // 👈 
        const choch = marketSMC.choch; // 👈 

        // 💰 User Margin
        const userMargin = await db.getMargin(m.sender) || 0;
        let marginInfo = userMargin > 0 ? `User's Available Margin: $${userMargin}` : "No margin set. Suggest defaults.";

        // Math
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
        const rrrLong = ((parseFloat(longTP2) - parseFloat(longEntry)) / longRisk).toFixed(2);

        // SHORT Calculations
        const shortEntry = res.toFixed(2); 
        const shortTP1 = fib618.toFixed(2);
        const shortTP2 = sup.toFixed(2);
        const shortTP3 = extMinus1618.toFixed(2);
        const shortSL = (swingHigh + (atrVal * 1.5)).toFixed(2);
        const shortRisk = Math.max(parseFloat(shortSL) - parseFloat(shortEntry), 0.0001);
        const rrrShort = ((parseFloat(shortEntry) - parseFloat(shortTP2)) / shortRisk).toFixed(2);

        // 🧮 Futures Position Sizing Math (Risk 2%, Deploy 10% of margin per trade)
        let longLevText = "N/A", longMarginText = "N/A", riskText = "N/A";
        let shortLevText = "N/A", shortMarginText = "N/A";
        
        if (userMargin > 0) {
            let riskAmount = userMargin * 0.02; // 2% risk
            let deployedMargin = userMargin * 0.10; // Use 10%
            riskText = `$${riskAmount.toFixed(2)}`;

            // Long Position Size & Leverage
            let longSlPercent = longRisk / parseFloat(longEntry);
            let longPosSize = riskAmount / longSlPercent;
            let reqLongLev = Math.ceil(longPosSize / deployedMargin);
            if(reqLongLev < 1) reqLongLev = 1; else if(reqLongLev > 100) reqLongLev = 100;
            longLevText = `${reqLongLev}x (Isolated)`;
            longMarginText = `$${deployedMargin.toFixed(2)}`;

            // Short Position Size & Leverage
            let shortSlPercent = shortRisk / parseFloat(shortEntry);
            let shortPosSize = riskAmount / shortSlPercent;
            let reqShortLev = Math.ceil(shortPosSize / deployedMargin);
            if(reqShortLev < 1) reqShortLev = 1; else if(reqShortLev > 100) reqShortLev = 100;
            shortLevText = `${reqShortLev}x (Isolated)`;
            shortMarginText = `$${deployedMargin.toFixed(2)}`;
        } else {
            longLevText = "Please set .margin"; longMarginText = "N/A";
            shortLevText = "Please set .margin"; shortMarginText = "N/A";
        }

        const prompt = `You are a Master Institutional Crypto AI. Analyze ${coin} for FUTURES TRADING.
        Current Price: $${currentPrice}
        ${marginInfo}
        
        [DATA FEED]
        - MTF EMA(50): ${timeframe}=$${emaCurrent}, 1H=$${ema1H}, 4H=$${ema4H}
        - Sentiment: F&G Index=${fng} | News=${news}
        - Order Flow: Bids=$${orderBook.totalBids}, Asks=$${orderBook.totalAsks} | POC=$${poc}
        - TA: RSI=${rsi} | MACD=${macd} | Pattern=${candlePattern} | Divergence=${divergence}
        - Smart Money: ChoCH=${choch} | Liquidity Sweep=${sweep}

        CRITICAL MATH RULES:
        If LONG, output EXACTLY: entry: "${longEntry}", tp1: "${longTP1}", tp2: "${longTP2}", tp3: "${longTP3}", sl: "${longSL}", rrr: "1:${rrrLong}", leverage: "${longLevText}", margin: "${longMarginText}", risk: "${riskText}"
        If SHORT, output EXACTLY: entry: "${shortEntry}", tp1: "${shortTP1}", tp2: "${shortTP2}", tp3: "${shortTP3}", sl: "${shortSL}", rrr: "1:${rrrShort}", leverage: "${shortLevText}", margin: "${shortMarginText}", risk: "${riskText}"

        CRITICAL LANGUAGE RULES:
        1. Write explanations STRICTLY using the Sinhala alphabet.
        2. DO NOT use Singlish.
        3. Keep technical trading terms EXACTLY in English.

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
          "leverage": "Strictly the leverage provided",
          "margin": "Strictly the margin provided",
          "risk": "Strictly the risk provided",
          "confidence": "e.g., 85%",
          "trend": "Explain in proper Sinhala alphabet.",
          "sentiment": "Explain in proper Sinhala alphabet.",
          "momentum": "Explain in proper Sinhala alphabet."
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
🛡️ Stop Loss (SL): $${data.sl} 

*⚖️ Risk Management (2% Risk)*
Risk/Reward (RRR): ${data.rrr}
⚙️ Exact Leverage: ${data.leverage}
💰 Margin to Deploy: ${data.margin}
🛡️ Max Risk Amount: ${data.risk}
Confidence: ${data.confidence} 🔥

*📊 Market Analysis*
Trend: ${data.trend}
Sentiment: ${data.sentiment}
Momentum: ${data.momentum}

⚡ සටහන: ඔබේ ප්‍රාග්ධනය .margin මගින් යාවත්කාලීන කරන්න.
📌 Track කිරීමට .track ලෙස Reply කරන්න.
[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`;
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්. නැවත උත්සාහ කරන්න.'); console.log(e); }
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
