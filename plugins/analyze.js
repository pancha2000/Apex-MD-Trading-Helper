const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

// ================== SPOT COMMAND (Ultimate Version) ==================
cmd({
    pattern: "spot",
    desc: "Ultimate Spot AI with VWAP, OB, Breakouts & Margin sizing",
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
        await reply(`⏳ *Ultimate Spot විශ්ලේෂණය ආරම්භ කෙරේ...*`);

        const currentCandles = await binance.getKlineData(coin, timeframe);
        const tf4hCandles = await binance.getKlineData(coin, '4h', 60);
        const tf1dCandles = await binance.getKlineData(coin, '1d', 60);
        
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();
        const news = await binance.getNewsHeadlines();
        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        // 📊 Indicators (VWAP & Breakouts)
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema4H = indicators.calculateEMA(tf4hCandles);
        const atr = indicators.calculateATR(currentCandles);
        const macd = indicators.calculateMACD(currentCandles);
        const vwap = indicators.calculateVWAP(currentCandles);
        const breakout = indicators.checkVolumeBreakout(currentCandles);
        
        // 🧠 SMC (Order Blocks & KillZones)
        const marketSMC = smc.analyzeSMC(currentCandles);
        const sweep = marketSMC.sweep; 
        const choch = marketSMC.choch; 
        const bullOB = marketSMC.bullishOB;
        const bearOB = marketSMC.bearishOB;
        const killzone = marketSMC.killzone;

        // 💰 User Margin
        const userMargin = await db.getMargin(m.sender) || 0;
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
        let spotAllocText = "N/A", riskText = "N/A";
        if (userMargin > 0) {
            let riskMoney = userMargin * 0.02; // 2% risk
            let slPercent = risk / parseFloat(spotEntry);
            let posSize = riskMoney / slPercent;
            spotAllocText = posSize > userMargin ? `Max $${userMargin} (Full Margin)` : `$${posSize.toFixed(2)}`;
            riskText = `$${riskMoney.toFixed(2)}`;
        } else {
            spotAllocText = "Set .margin"; riskText = "Set .margin";
        }

        const prompt = `You are a Master Institutional Crypto Spot Trader. Analyze ${coin} for SPOT TRADING.
        Current Price: $${currentPrice} | Active Session: ${killzone}
        
        [DATA FEED]
        - TA: VWAP=${vwap} | Breakout=${breakout} | RSI=${rsi} | MACD=${macd}
        - SMC: ChoCH=${choch} | Sweep=${sweep} | Bull OB=${bullOB} | Bear OB=${bearOB}
        - Sentiment: F&G Index=${fng} | News=${news}

        CRITICAL MATH RULES:
        If BUY, you MUST output exactly:
        entry: "${spotEntry}", tp1: "${spotTP1}", tp2: "${spotTP2}", tp3: "${spotTP3}", sl: "${spotSL}", rrr: "1:${rrr}", allocation: "${spotAllocText}", riskAmt: "${riskText}"
        If Fakeout detected or bad Risk, output WAIT.

        CRITICAL LANGUAGE RULES:
        1. Write explanations STRICTLY using the Sinhala alphabet. DO NOT use Singlish.
        2. Keep technical terms in English (e.g. Order Block, VWAP, Fakeout).

        Respond ONLY with a valid JSON:
        {
          "direction": "BUY or HOLD or WAIT",
          "emoji": "🟢 or ⚪",
          "entry": "Strictly the number provided",
          "tp1": "Strictly the number provided",
          "tp2": "Strictly the number provided",
          "tp3": "Strictly the number provided",
          "sl": "Strictly the number provided",
          "rrr": "Strictly the RRR provided",
          "allocation": "Strictly the allocation provided",
          "riskAmt": "Strictly the riskAmt provided",
          "confidence": "e.g., 90%",
          "trend": "Explain trend in proper Sinhala alphabet.",
          "smc_summary": "Explain OB, VWAP & Breakouts in proper Sinhala alphabet."
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
⏱️ Session: ${killzone}

 *🎯 Trade Setup* 📉 Direction: ${data.direction} ${data.emoji}

📍 Entry Price: $${data.entry} 
🎯 Take Profits (TP):
   ▪️ TP 1 (Safe): $${data.tp1}
   ▪️ TP 2 (Main): $${data.tp2}
   ▪️ TP 3 (Moon): $${data.tp3}
🛡️ Stop Loss (SL): $${data.sl} 

*⚖️ Risk Management (2% Risk)*
Risk/Reward (RRR): ${data.rrr}
💰 Investment to Deploy: ${data.allocation}
🛡️ Max Risk Amount: ${data.riskAmt}
Confidence: ${data.confidence} 🔥

*📊 Institutional Analysis*
Trend: ${data.trend}
Smart Money & Volume: ${data.smc_summary}

⚡ සටහන: ඔබේ ප්‍රාග්ධනය .margin මගින් යාවත්කාලීන කරන්න.
📌 Track කිරීමට .track ලෙස Reply කරන්න.
[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`;
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්. නැවත උත්සාහ කරන්න.'); console.log(e); }
});

// ================== FUTURES COMMAND (Ultimate Version) ==================
cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Ultimate Futures AI with VWAP, OB & Breakouts",
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
        await reply(`⏳ *Ultimate Futures විශ්ලේෂණය ආරම්භ කෙරේ...*`);

        const currentCandles = await binance.getKlineData(coin, timeframe);
        const hourlyCandles = await binance.getKlineData(coin, '1h', 60); 
        const macroCandles = await binance.getKlineData(coin, '4h', 60);  
        
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();
        const news = await binance.getNewsHeadlines();
        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        // 📊 Indicators (VWAP & Breakouts ඇතුළුව)
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema4H = indicators.calculateEMA(macroCandles);
        const atr = indicators.calculateATR(currentCandles);
        const macd = indicators.calculateMACD(currentCandles);
        const vwap = indicators.calculateVWAP(currentCandles);
        const breakout = indicators.checkVolumeBreakout(currentCandles);
        
        // 🧠 SMC (Order Blocks & KillZones ඇතුළුව)
        const marketSMC = smc.analyzeSMC(currentCandles);
        const sweep = marketSMC.sweep; 
        const choch = marketSMC.choch; 
        const bullOB = marketSMC.bullishOB;
        const bearOB = marketSMC.bearishOB;
        const killzone = marketSMC.killzone;

        // 💰 Margin Math
        const userMargin = await db.getMargin(m.sender) || 0;
        const atrVal = parseFloat(atr);
        const fib618 = parseFloat(marketSMC.fib618);
        const res = parseFloat(marketSMC.resistance);
        const sup = parseFloat(marketSMC.support);
        const swingHigh = parseFloat(marketSMC.swingHigh);
        const swingLow = parseFloat(marketSMC.swingLow);
        const ext1618 = parseFloat(marketSMC.ext1618);
        const ext2618 = parseFloat(marketSMC.ext2618);
        const extMinus1618 = parseFloat(marketSMC.extMinus1618);

        // LONG Math
        const longEntry = fib618.toFixed(2); 
        const longTP1 = res.toFixed(2);
        const longTP2 = ext1618.toFixed(2);
        const longTP3 = ext2618.toFixed(2);
        const longSL = (swingLow - (atrVal * 1.5)).toFixed(2);
        const longRisk = Math.max(parseFloat(longEntry) - parseFloat(longSL), 0.0001);
        const rrrLong = ((parseFloat(longTP2) - parseFloat(longEntry)) / longRisk).toFixed(2);

        // SHORT Math
        const shortEntry = res.toFixed(2); 
        const shortTP1 = fib618.toFixed(2);
        const shortTP2 = sup.toFixed(2);
        const shortTP3 = extMinus1618.toFixed(2);
        const shortSL = (swingHigh + (atrVal * 1.5)).toFixed(2);
        const shortRisk = Math.max(parseFloat(shortSL) - parseFloat(shortEntry), 0.0001);
        const rrrShort = ((parseFloat(shortEntry) - parseFloat(shortTP2)) / shortRisk).toFixed(2);

        // Position Sizing
        let longLevText = "N/A", longMarginText = "N/A", riskText = "N/A";
        let shortLevText = "N/A", shortMarginText = "N/A";
        if (userMargin > 0) {
            let riskAmount = userMargin * 0.02; 
            let deployedMargin = userMargin * 0.10; 
            riskText = `$${riskAmount.toFixed(2)}`;

            let longSlPercent = longRisk / parseFloat(longEntry);
            let reqLongLev = Math.ceil((riskAmount / longSlPercent) / deployedMargin);
            longLevText = `${Math.min(Math.max(reqLongLev, 1), 100)}x (Isolated)`;
            longMarginText = `$${deployedMargin.toFixed(2)}`;

            let shortSlPercent = shortRisk / parseFloat(shortEntry);
            let reqShortLev = Math.ceil((riskAmount / shortSlPercent) / deployedMargin);
            shortLevText = `${Math.min(Math.max(reqShortLev, 1), 100)}x (Isolated)`;
            shortMarginText = `$${deployedMargin.toFixed(2)}`;
        } else {
            longLevText = "Set .margin"; shortLevText = "Set .margin";
        }

        const prompt = `You are a Master Institutional Crypto AI. Analyze ${coin} for FUTURES TRADING.
        Current Price: $${currentPrice} | Active Session: ${killzone}
        
        [DATA FEED]
        - TA: VWAP=${vwap} | Breakout=${breakout} | RSI=${rsi} | MACD=${macd}
        - SMC: ChoCH=${choch} | Sweep=${sweep} | Bull OB=${bullOB} | Bear OB=${bearOB}
        - Sentiment: F&G Index=${fng} | News=${news}

        CRITICAL MATH RULES:
        If LONG: entry: "${longEntry}", tp1: "${longTP1}", tp2: "${longTP2}", tp3: "${longTP3}", sl: "${longSL}", rrr: "1:${rrrLong}", leverage: "${longLevText}", margin: "${longMarginText}", risk: "${riskText}"
        If SHORT: entry: "${shortEntry}", tp1: "${shortTP1}", tp2: "${shortTP2}", tp3: "${shortTP3}", sl: "${shortSL}", rrr: "1:${rrrShort}", leverage: "${shortLevText}", margin: "${shortMarginText}", risk: "${riskText}"
        If Fakeout detected or bad Risk, output WAIT.

        CRITICAL LANGUAGE RULES:
        1. Write explanations STRICTLY using the Sinhala alphabet. DO NOT use Singlish.
        2. Keep technical terms in English (e.g. Order Block, VWAP, Fakeout).

        Respond ONLY with a valid JSON:
        {
          "direction": "LONG (Buy) or SHORT (Sell) or WAIT (Neutral)",
          "emoji": "🟢 or 🔴 or ⚪",
          "entry": "Strictly the number provided",
          "tp1": "Strictly the number provided",
          "tp2": "Strictly the number provided",
          "tp3": "Strictly the number provided",
          "sl": "Strictly the number provided",
          "rrr": "Strictly the RRR provided",
          "leverage": "Strictly the leverage provided",
          "margin": "Strictly the margin provided",
          "risk": "Strictly the risk provided",
          "confidence": "e.g., 90%",
          "trend": "Explain trend in proper Sinhala alphabet.",
          "smc_summary": "Explain OB, VWAP & Fakeouts in proper Sinhala alphabet."
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
⏱️ Session: ${killzone}

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

*📊 Institutional Analysis*
Trend: ${data.trend}
Smart Money & Volume: ${data.smc_summary}

⚡ සටහන: ඔබේ ප්‍රාග්ධනය .margin මගින් යාවත්කාලීන කරන්න.
📌 Track කිරීමට .track ලෙස Reply කරන්න.
[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`;
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්. නැවත උත්සාහ කරන්න.'); console.log(e); }
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
