const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Ultimate Futures AI with Dynamic Strict Mode",
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
        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();
        const liqData = await binance.getLiquidationData(coin);
        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        const rsi = indicators.calculateRSI(currentCandles);
        const atr = indicators.calculateATR(currentCandles);
        const macd = indicators.calculateMACD(currentCandles);
        const vwap = indicators.calculateVWAP(currentCandles);
        const breakout = indicators.checkVolumeBreakout(currentCandles);
        
        const marketSMC = smc.analyzeSMC(currentCandles);
        const userMargin = await db.getMargin(m.sender) || 0;
        const settings = await db.getSettings(); // 👈 Settings කියවන තැන

        const atrVal = parseFloat(atr);
        const fib618 = parseFloat(marketSMC.fib618);
        const res = parseFloat(marketSMC.resistance);
        const sup = parseFloat(marketSMC.support);
        const ext1618 = parseFloat(marketSMC.ext1618);
        const ext2618 = parseFloat(marketSMC.ext2618);
        const extMinus1618 = parseFloat(marketSMC.extMinus1618);

        const longEntry = fib618.toFixed(2); 
        const longTP1 = res.toFixed(2);
        const longTP2 = ext1618.toFixed(2);
        const longTP3 = ext2618.toFixed(2);
        const longSL = (parseFloat(longEntry) - (atrVal * 2.0)).toFixed(2);
        const longRisk = Math.abs(parseFloat(longEntry) - parseFloat(longSL));
        const rrrLong = longRisk > 0 ? ((parseFloat(longTP2) - parseFloat(longEntry)) / longRisk).toFixed(2) : "0.00";

        const shortEntry = res.toFixed(2); 
        const shortTP1 = fib618.toFixed(2);
        const shortTP2 = sup.toFixed(2);
        const shortTP3 = extMinus1618.toFixed(2);
        const shortSL = (parseFloat(shortEntry) + (atrVal * 2.0)).toFixed(2);
        const shortRisk = Math.abs(parseFloat(shortSL) - parseFloat(shortEntry));
        const rrrShort = shortRisk > 0 ? ((parseFloat(shortEntry) - parseFloat(shortTP2)) / shortRisk).toFixed(2) : "0.00";

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

        // 👈 අලුත් Strict Mode ලොජික් එක මෙන්න
        let strictRule = settings.strictMode 
            ? "If Fakeout detected or bad Risk, output WAIT."
            : "Even if a Fakeout or High Liquidation Risk is detected, IF there is a valid technical Entry, you MUST output the EXACT LONG/SHORT targets (entry, tp, sl). HOWEVER, you MUST lower the confidence to below 50% and include a STRONG WARNING starting with '⚠️ AVOID / HIGH RISK:' inside the 'smc_summary'. Only output WAIT if there is absolutely no mathematical entry point.";

        const prompt = `You are a Master Crypto AI. Analyze ${coin} for FUTURES.
        Current Price: $${currentPrice} | Session: ${marketSMC.killzone}
        
        [DATA]
        - TA: VWAP=${vwap} | Breakout=${breakout} | RSI=${rsi} | MACD=${macd}
        - SMC: ChoCH=${marketSMC.choch} | Bull OB=${marketSMC.bullishOB} | Bear OB=${marketSMC.bearishOB}
        - Liquidation: Sentiment=${liqData.sentiment}

        CRITICAL MATH RULES:
        If LONG: entry: "${longEntry}", tp1: "${longTP1}", tp2: "${longTP2}", tp3: "${longTP3}", sl: "${longSL}", rrr: "1:${rrrLong}", leverage: "${longLevText}", margin: "${longMarginText}", risk: "${riskText}"
        If SHORT: entry: "${shortEntry}", tp1: "${shortTP1}", tp2: "${shortTP2}", tp3: "${shortTP3}", sl: "${shortSL}", rrr: "1:${rrrShort}", leverage: "${shortLevText}", margin: "${shortMarginText}", risk: "${riskText}"
        ${strictRule}

        CRITICAL LANGUAGE RULES:
        1. Write explanations STRICTLY using the Sinhala alphabet.
        2. 🛑 DO NOT translate technical acronyms/terms (VWAP, MACD, RSI, Order Block, Breakout, SMC). Keep them EXACTLY in English within the Sinhala sentences. 

        Respond ONLY with valid JSON:
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
          "trend": "Explain trend in Sinhala.",
          "smc_summary": "Explain OB, VWAP & Fakeouts in Sinhala."
        }`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        let data = JSON.parse(aiRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        let trackMsg = "";
        if (data.direction !== "WAIT" && data.direction !== "HOLD") {
            trackMsg = `\n📌 Track කිරීමට .track ලෙස Reply කරන්න.\n[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`;
        }

        const outMsg = `
╔═══════════════════════════╗
║ 🔴 *PRO FUTURES ANALYSIS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Session: ${marketSMC.killzone}

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
⚠️ Liquidation Risk: ${liqData.sentiment}

⚡ සටහන: ඔබේ ප්‍රාග්ධනය .margin මගින් යාවත්කාලීන කරන්න.${trackMsg}`;
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්.'); }
});
