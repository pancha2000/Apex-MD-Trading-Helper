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
    desc: "Ultimate Futures AI with Sniper Entry & EMA 200",
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
        await reply(`⏳ *Sniper Confirmations සමඟ විශ්ලේෂණය ආරම්භ කෙරේ...*\n(EMA 200 සහ Market Noise පරීක්ෂා කරමින් පවතී)`);

        // දත්ත ගැනීම (Candles 200 ක් ගන්නවා EMA 200 හදන්න)
        const currentCandles = await binance.getKlineData(coin, timeframe, 200); 
        const candles1H = await binance.getKlineData(coin, '1h', 60);
        const candles4H = await binance.getKlineData(coin, '4h', 60);
        
        const fng = await binance.getFearAndGreed();
        const liqData = await binance.getLiquidationData(coin);
        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        // 🚀 අලුත්: EMA 200 සහ Choppy Market Filter
        const ema200 = parseFloat(indicators.calculateEMA(currentCandles, 200));
        const ema50 = parseFloat(indicators.calculateEMA(currentCandles.slice(-50), 50));
        const ema21 = parseFloat(indicators.calculateEMA(currentCandles.slice(-21), 21));
        
        const mainTrend = currentPrice > ema200 ? "Bullish (Uptrend) 🟢" : "Bearish (Downtrend) 🔴";
        // EMA 21 සහ 50 ගොඩක් ළඟ නම් (0.15% කට වඩා අඩුවෙන්) ඒක Choppy Market එකක්!
        const isChoppy = Math.abs(ema50 - ema21) / ema50 < 0.0015; 
        const marketState = isChoppy ? "CHOPPY / SIDEWAYS ⚠️ (DO NOT TRADE)" : "TRENDING 🚀 (SAFE TO TRADE)";

        const ema1H = parseFloat(indicators.calculateEMA(candles1H, 50));
        const ema4H = parseFloat(indicators.calculateEMA(candles4H, 50));
        const trend1H = parseFloat(candles1H[candles1H.length - 1][4]) > ema1H ? "Bullish 🟢" : "Bearish 🔴";
        const trend4H = parseFloat(candles4H[candles4H.length - 1][4]) > ema4H ? "Bullish 🟢" : "Bearish 🔴";
        const mtfTrend = `4H: ${trend4H} | 1H: ${trend1H}`;

        const rsi = indicators.calculateRSI(currentCandles.slice(-50));
        const atr = indicators.calculateATR(currentCandles.slice(-50));
        const macd = indicators.calculateMACD(currentCandles.slice(-50));
        const vwap = indicators.calculateVWAP(currentCandles.slice(-50));
        
        const marketSMC = smc.analyzeSMC(currentCandles.slice(-50));
        const userMargin = await db.getMargin(m.sender) || 0;
        const settings = await db.getSettings(); 

        const atrVal = parseFloat(atr);
        const fib618 = parseFloat(marketSMC.fib618);
        const res = parseFloat(marketSMC.resistance);
        const sup = parseFloat(marketSMC.support);

        // Sniper Entries
        const longEntry = fib618.toFixed(2); 
        const longTP1 = (parseFloat(longEntry) + (atrVal * 2.5)).toFixed(2);
        const longTP2 = (parseFloat(longEntry) + (atrVal * 4.0)).toFixed(2);
        const longSL = (parseFloat(longEntry) - (atrVal * 1.5)).toFixed(2);
        const rrrLong = ((parseFloat(longTP2) - parseFloat(longEntry)) / (parseFloat(longEntry) - parseFloat(longSL))).toFixed(2);

        const shortEntry = res.toFixed(2); 
        const shortTP1 = (parseFloat(shortEntry) - (atrVal * 2.5)).toFixed(2);
        const shortTP2 = (parseFloat(shortEntry) - (atrVal * 4.0)).toFixed(2);
        const shortSL = (parseFloat(shortEntry) + (atrVal * 1.5)).toFixed(2);
        const rrrShort = ((parseFloat(shortEntry) - parseFloat(shortTP2)) / (parseFloat(shortSL) - parseFloat(shortEntry))).toFixed(2);

        let longLevText = "N/A", riskText = "N/A", shortLevText = "N/A", marginText = "N/A";
        if (userMargin > 0) {
            let riskAmount = userMargin * 0.02; 
            let deployedMargin = userMargin * 0.10; 
            riskText = `$${riskAmount.toFixed(2)}`; marginText = `$${deployedMargin.toFixed(2)}`;
            longLevText = `${Math.min(Math.ceil((riskAmount / (Math.abs(parseFloat(longEntry)-parseFloat(longSL))/parseFloat(longEntry))) / deployedMargin), 100)}x (Iso)`;
            shortLevText = `${Math.min(Math.ceil((riskAmount / (Math.abs(parseFloat(shortSL)-parseFloat(shortEntry))/parseFloat(shortEntry))) / deployedMargin), 100)}x (Iso)`;
        } else { longLevText = "Set .margin"; shortLevText = "Set .margin"; }

        let strictRule = settings.strictMode 
            ? "If Market State is CHOPPY, or MTF Trend opposes EMA 200, output WAIT. NEVER long under EMA200. NEVER short above EMA200."
            : "Even if Choppy, if there is a valid setup, output EXACT targets with a STRONG WARNING below 50% confidence.";

        const prompt = `You are a Master Crypto Sniper. Analyze ${coin} FUTURES.
        Current Price: $${currentPrice}
        
        [ULTIMATE DATA]
        - Market State: ${marketState}
        - 15m EMA 200 Trend: ${mainTrend} (CRITICAL: Never trade against this!)
        - MTF Trend: ${mtfTrend}
        - FVG: Bull=${marketSMC.bullishFVG} | Bear=${marketSMC.bearishFVG}
        - TA: VWAP=${vwap} | RSI=${rsi} | MACD=${macd}
        - SMC: Bull OB=${marketSMC.bullishOB} | Bear OB=${marketSMC.bearishOB}
        - Sentiment: Liquidation=${liqData.sentiment}

        CRITICAL MATH RULES:
        If LONG: entry: "${longEntry}", tp1: "${longTP1}", tp2: "${longTP2}", sl: "${longSL}", rrr: "1:${rrrLong}", leverage: "${longLevText}", margin: "${marginText}", risk: "${riskText}"
        If SHORT: entry: "${shortEntry}", tp1: "${shortTP1}", tp2: "${shortTP2}", sl: "${shortSL}", rrr: "1:${rrrShort}", leverage: "${shortLevText}", margin: "${marginText}", risk: "${riskText}"
        ${strictRule}

        CRITICAL LANGUAGE RULES: Write explanations in Sinhala alphabet. DO NOT translate terms like EMA 200, MTF, Choppy, FVG, OB.

        Respond ONLY with JSON:
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
          "trend": "Explain EMA 200 & MTF in Sinhala.",
          "smc_summary": "Explain Market State (Choppy/Trending) & OB/FVG in Sinhala."
        }`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, { model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        let data = JSON.parse(aiRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        let trackMsg = data.direction !== "WAIT" && data.direction !== "HOLD" ? `\n📌 Track කිරීමට .track ලෙස Reply කරන්න.\n[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]` : "";

        const outMsg = `
╔═══════════════════════════╗
║ 🎯 *PRO SNIPER ANALYSIS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Session: ${marketSMC.killzone}

 *🎯 Trade Setup* 📉 Direction: ${data.direction} ${data.emoji}

📍 Entry Price: $${data.entry} 
🎯 Take Profits (TP):
   ▪️ TP 1 (Safe): $${data.tp1}
   ▪️ TP 2 (Main): $${data.tp2}
🛡️ Stop Loss (SL): $${data.sl} 

*⚖️ Risk Management (2% Risk)*
Risk/Reward (RRR): ${data.rrr}
⚙️ Exact Leverage: ${data.leverage}
💰 Margin to Deploy: ${data.margin}
🛡️ Max Risk Amount: ${data.risk}
Confidence: ${data.confidence} 🔥

*📊 Market Confirmations*
📌 EMA 200 Trend: ${mainTrend}
📌 Market State: ${marketState}
📌 Higher Timeframe: ${mtfTrend}

*💡 AI Analysis:*
Trend: ${data.trend}
Smart Money & Volume: ${data.smc_summary}

⚡ සටහන: ඔබේ ප්‍රාග්ධනය .margin මගින් යාවත්කාලීන කරන්න.${trackMsg}`;
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්. ' + e.message); }
});
