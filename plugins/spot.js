const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

cmd({
    pattern: "spot",
    desc: "Ultimate Spot AI with Dynamic Strict Mode",
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

        const currentCandles = await binance.getKlineData(coin, timeframe, 100);
        const tf4hCandles = await binance.getKlineData(coin, '4h', 60);
        const tf1dCandles = await binance.getKlineData(coin, '1d', 60);

        const orderBook = await binance.getOrderBook(coin);
        const fng = await binance.getFearAndGreed();
        const news = await binance.getNewsHeadlines();
        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);

        // ✅ FIX: Enough candles for RSI Wilder method
        const rsi = indicators.calculateRSI(currentCandles.slice(-50), 14);
        const emaCurrent = indicators.calculateEMA(currentCandles, 50);
        const atr = indicators.calculateATR(currentCandles.slice(-20));
        const macd = indicators.calculateMACD(currentCandles.slice(-50));
        const vwap = indicators.calculateVWAP(currentCandles); // ✅ Full candles for daily VWAP reset
        const breakout = indicators.checkVolumeBreakout(currentCandles.slice(-50));
        const divergence = indicators.checkDivergence(currentCandles.slice(-50));

        const marketSMC = smc.analyzeSMC(currentCandles.slice(-50));
        const userMargin = await db.getMargin(m.sender) || 0;
        const settings = await db.getSettings();

        const atrVal = parseFloat(atr);
        const fib618 = parseFloat(marketSMC.fib618);
        const res = parseFloat(marketSMC.resistance);
        const ext1618 = parseFloat(marketSMC.ext1618);
        const ext2618 = parseFloat(marketSMC.ext2618);

        const spotEntry = fib618.toFixed(2);
        const spotTP1 = res.toFixed(2);
        const spotTP2 = ext1618.toFixed(2);
        const spotTP3 = ext2618.toFixed(2);
        const spotSL = (parseFloat(spotEntry) - (atrVal * 2.0)).toFixed(2);

        const risk = Math.abs(parseFloat(spotEntry) - parseFloat(spotSL));
        const reward = Math.abs(parseFloat(spotTP2) - parseFloat(spotEntry));
        const rrr = risk > 0 ? (reward / risk).toFixed(2) : "0.00";

        let spotAllocText = "N/A", riskText = "N/A";
        if (userMargin > 0) {
            let riskMoney = userMargin * 0.02;
            let slPercent = risk / parseFloat(spotEntry);
            let posSize = riskMoney / slPercent;
            spotAllocText = posSize > userMargin ? `Max $${userMargin} (Full Margin)` : `$${posSize.toFixed(2)}`;
            riskText = `$${riskMoney.toFixed(2)}`;
        } else {
            spotAllocText = "Set .margin"; riskText = "Set .margin";
        }

        // ✅ FIX: Entry Validation for Spot
        const entryValidation = indicators.validateEntryPoint(spotEntry, currentPrice, 'LONG');
        let entryWarnMsg = entryValidation.warning ? `\n\n${entryValidation.warning}` : "";

        // ✅ FIX: Asian session warning
        const asianWarning = marketSMC.killzone.includes("Asian")
            ? "\n⚠️ *ASIAN SESSION:* Fakeout risk ඉහළයි. London Open දක්වා wait කරන්න."
            : "";

        let strictRule = settings.strictMode
            ? "If Fakeout detected, bad Risk, or Asian session, output WAIT."
            : "Even if Fakeout detected, IF valid technical entry exists, output EXACT targets with low confidence and STRONG WARNING.";

        const prompt = `You are a Master Institutional Crypto Spot Trader. Analyze ${coin} for SPOT TRADING.
Current Price: $${currentPrice} | Session: ${marketSMC.killzone}

[DATA FEED]
- RSI: ${rsi} (Oversold <35, Overbought >65 for crypto)
- VWAP: ${vwap} | Breakout: ${breakout}
- Divergence: ${divergence}
- MACD: ${macd}
- SMC: ChoCH=${marketSMC.choch} | Sweep=${marketSMC.sweep}
- Bullish OB: ${marketSMC.bullishOB}
- Sentiment: F&G=${fng}

CRITICAL MATH RULES:
If BUY, output EXACTLY: entry: "${spotEntry}", tp1: "${spotTP1}", tp2: "${spotTP2}", tp3: "${spotTP3}", sl: "${spotSL}", rrr: "1:${rrr}", allocation: "${spotAllocText}", riskAmt: "${riskText}"
${strictRule}

CRITICAL LANGUAGE RULES:
1. Write explanations in Sinhala alphabet only.
2. Keep technical terms (VWAP, MACD, RSI, Order Block, SMC) in English.

Respond ONLY with valid JSON:
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
  "trend": "Explain trend in Sinhala.",
  "smc_summary": "Explain OB, VWAP, Divergence & Breakout in Sinhala (keeping acronyms English)."
}`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const rawContent = aiRes.data.choices[0].message.content;
        const jsonMatch = rawContent.replace(/```(?:json)?\n?/g, '').match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(`AI invalid JSON: ${rawContent.substring(0, 200)}`);
        let data = JSON.parse(jsonMatch[0]);

        let trackMsg = "";
        if (data.direction !== "WAIT" && data.direction !== "HOLD") {
            trackMsg = `\n📌 Track කිරීමට .track ලෙස Reply කරන්න.\n[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`;
        }

        const outMsg = `
╔═══════════════════════════╗
║  🟢 *PRO SPOT ANALYSIS*  ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Session: ${marketSMC.killzone}${asianWarning}

*🎯 Trade Setup* ${data.emoji} Direction: ${data.direction}

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
Smart Money & Volume: ${data.smc_summary}${entryWarnMsg}

⚡ සටහන: ඔබේ ප්‍රාග්ධනය .margin මගින් යාවත්කාලීන කරන්න.${trackMsg}`;

        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) {
        console.error('❌ Spot Analysis Error:', e.message || e);
        await reply(`❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්.\n🔍 සටහන: ${e.message || 'නොදන්නා දෝෂයක්'}`);
    }
});