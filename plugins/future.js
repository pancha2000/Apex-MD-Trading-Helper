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
    desc: "Ultimate Futures AI with Confluence Scoring",
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
        await reply(`⏳ *${coin} හි ගැඹුරු විශ්ලේෂණය ආරම්භ කෙරේ...*\n(Confluence Scoring + Entry Validation)`);

        const currentCandles = await binance.getKlineData(coin, timeframe, 200);
        const candles1H = await binance.getKlineData(coin, '1h', 60);
        const candles4H = await binance.getKlineData(coin, '4h', 60);
        const liqData = await binance.getLiquidationData(coin);
        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);

        const ema200 = parseFloat(indicators.calculateEMA(currentCandles, 200));
        const ema50 = parseFloat(indicators.calculateEMA(currentCandles.slice(-100), 50));
        const ema21 = parseFloat(indicators.calculateEMA(currentCandles.slice(-50), 21));

        const mainTrend = parseFloat(currentPrice) > ema200 ? "Bullish (Uptrend) 🟢" : "Bearish (Downtrend) 🔴";
        const isChoppy = Math.abs(ema50 - ema21) / ema50 < 0.0015;
        const marketState = isChoppy ? "CHOPPY / SIDEWAYS ⚠️" : "TRENDING 🚀";

        const ema1H = parseFloat(indicators.calculateEMA(candles1H, 50));
        const ema4H = parseFloat(indicators.calculateEMA(candles4H, 50));
        const trend1H = parseFloat(candles1H[candles1H.length - 1][4]) > ema1H ? "Bullish 🟢" : "Bearish 🔴";
        const trend4H = parseFloat(candles4H[candles4H.length - 1][4]) > ema4H ? "Bullish 🟢" : "Bearish 🔴";
        const mtfTrend = `4H: ${trend4H} | 1H: ${trend1H}`;

        // ✅ FIX: නිවැරදි RSI - enough candles සහිතව
        const rsi = indicators.calculateRSI(currentCandles.slice(-50), 14);
        const atr = indicators.calculateATR(currentCandles.slice(-50));
        const macd = indicators.calculateMACD(currentCandles.slice(-50));
        const vwap = indicators.calculateVWAP(currentCandles.slice(-50));
        const poc = indicators.calculatePOC(currentCandles.slice(-50));
        const pattern = indicators.checkCandlePattern(currentCandles.slice(-10));

        // ✅ FIX: Volume Breakout සහ Divergence calculate
        const volBreak = indicators.checkVolumeBreakout(currentCandles.slice(-50));
        const divergence = indicators.checkDivergence(currentCandles.slice(-50));

        const marketSMC = smc.analyzeSMC(currentCandles.slice(-50));

        // ✅ FIX: Confluence Scoring - Volume & Divergence ද score කරනවා
        let longScore = 0, shortScore = 0;
        let longReasons = [], shortReasons = [];

        // 1. MTF
        if (trend4H.includes("Bullish") && trend1H.includes("Bullish")) { longScore++; longReasons.push("MTF Bullish"); }
        if (trend4H.includes("Bearish") && trend1H.includes("Bearish")) { shortScore++; shortReasons.push("MTF Bearish"); }

        // 2. EMA Pullback
        let diffFromEma50 = Math.abs(parseFloat(currentPrice) - ema50) / ema50;
        if (parseFloat(currentPrice) > ema200 && diffFromEma50 < 0.003) { longScore++; longReasons.push("EMA Pullback"); }
        if (parseFloat(currentPrice) < ema200 && diffFromEma50 < 0.003) { shortScore++; shortReasons.push("EMA Pullback"); }

        // 3. SMC
        if (marketSMC.bullishOB !== "None" || marketSMC.bullishFVG !== "None") { longScore++; longReasons.push("SMC Zones"); }
        if (marketSMC.bearishOB !== "None" || marketSMC.bearishFVG !== "None") { shortScore++; shortReasons.push("SMC Zones"); }

        // 4. ✅ FIX: RSI Thresholds - 30/70 (standard) වෙනුවට 35/65 (slightly relaxed for crypto)
        if (rsi < 35) { longScore++; longReasons.push("RSI Oversold"); }
        if (rsi > 65) { shortScore++; shortReasons.push("RSI Overbought"); }

        // 5. VWAP
        if (vwap.includes('🟢')) { longScore++; longReasons.push("Above VWAP"); }
        if (vwap.includes('🔴')) { shortScore++; shortReasons.push("Below VWAP"); }

        // 6. Candle Pattern
        if (pattern.includes('🟢')) { longScore++; longReasons.push("Candle Pattern"); }
        if (pattern.includes('🔴')) { shortScore++; shortReasons.push("Candle Pattern"); }

        // ✅ FIX: Volume Breakout Score (කලින් waste වුණා)
        if (volBreak.includes("Bullish Breakout")) { longScore++; longReasons.push("Vol Breakout"); }
        if (volBreak.includes("Bearish Breakout")) { shortScore++; shortReasons.push("Vol Breakout"); }

        // ✅ FIX: Divergence Score (කලින් waste වුණා)
        if (divergence.includes("Bullish")) { longScore++; longReasons.push("Bullish Divergence"); }
        if (divergence.includes("Bearish")) { shortScore++; shortReasons.push("Bearish Divergence"); }

        let finalScore = mainTrend.includes("Bullish") ? longScore : shortScore;
        let finalReasons = mainTrend.includes("Bullish") ? longReasons.join(', ') : shortReasons.join(', ');
        if (!finalReasons) finalReasons = "None matched";

        const maxScore = 8; // ✅ Updated: 6 -> 8 (volume + divergence)

        // Entries & TP/SL
        const atrVal = parseFloat(atr);
        let bestLongEntry = marketSMC.bullishOB !== "None"
            ? parseFloat(marketSMC.bullishOB.split(' - ')[0].replace('$', ''))
            : parseFloat(marketSMC.fib618);
        let bestShortEntry = marketSMC.bearishOB !== "None"
            ? parseFloat(marketSMC.bearishOB.split(' - ')[0].replace('$', ''))
            : parseFloat(marketSMC.resistance);

        const longEntry = bestLongEntry.toFixed(2);
        const longTP1 = (parseFloat(longEntry) + (atrVal * 2.5)).toFixed(2);
        const longTP2 = (parseFloat(longEntry) + (atrVal * 4.0)).toFixed(2);
        const longSL = (parseFloat(longEntry) - (atrVal * 1.5)).toFixed(2);
        const rrrLong = ((parseFloat(longTP2) - parseFloat(longEntry)) / (parseFloat(longEntry) - parseFloat(longSL))).toFixed(2);

        const shortEntry = bestShortEntry.toFixed(2);
        const shortTP1 = (parseFloat(shortEntry) - (atrVal * 2.5)).toFixed(2);
        const shortTP2 = (parseFloat(shortEntry) - (atrVal * 4.0)).toFixed(2);
        const shortSL = (parseFloat(shortEntry) + (atrVal * 1.5)).toFixed(2);
        const rrrShort = ((parseFloat(shortEntry) - parseFloat(shortTP2)) / (parseFloat(shortSL) - parseFloat(shortEntry))).toFixed(2);

        const userMargin = await db.getMargin(m.sender) || 0;
        const settings = await db.getSettings();

        let longLevText = "N/A", riskText = "N/A", shortLevText = "N/A", marginText = "N/A";
        if (userMargin > 0) {
            let riskAmount = userMargin * 0.02;
            let deployedMargin = userMargin * 0.10;
            riskText = `$${riskAmount.toFixed(2)}`; marginText = `$${deployedMargin.toFixed(2)}`;
            longLevText = `${Math.min(Math.ceil((riskAmount / (Math.abs(parseFloat(longEntry) - parseFloat(longSL)) / parseFloat(longEntry))) / deployedMargin), 100)}x (Iso)`;
            shortLevText = `${Math.min(Math.ceil((riskAmount / (Math.abs(parseFloat(shortSL) - parseFloat(shortEntry)) / parseFloat(shortEntry))) / deployedMargin), 100)}x (Iso)`;
        } else {
            longLevText = "Set .margin"; shortLevText = "Set .margin";
        }

        // ✅ FIX: Asian session warning
        const asianWarning = marketSMC.killzone.includes("Asian") 
            ? "\n⚠️ *ASIAN SESSION:* Fakeout risk ඉහළයි. London/NY session දක්වා wait කරන්න නිර්දේශ කෙරේ." 
            : "";

        let strictRule = settings.strictMode
            ? "If Score is less than 4, or Market is Choppy, or Asian session, output WAIT."
            : "Even if Score is low, output EXACT targets with a WARNING below 50% confidence.";

        const direction = mainTrend.includes("Bullish") ? "LONG" : "SHORT";

        // ✅ NEW: Entry Validation
        const entryToCheck = direction === 'LONG' ? longEntry : shortEntry;
        const entryValidation = indicators.validateEntryPoint(entryToCheck, currentPrice, direction);

        const prompt = `You are a Master Crypto AI. Analyze ${coin} FUTURES.
Current Price: $${currentPrice}

[CONFLUENCE SCORE: ${finalScore}/${maxScore}]
Passed Confluences: ${finalReasons}

[ULTIMATE DATA]
- Market State: ${marketState}
- 15m EMA200 Trend: ${mainTrend}
- MTF Trend: ${mtfTrend}
- RSI: ${rsi} (35/65 thresholds)
- POC: $${poc} | VWAP: ${vwap}
- Volume: ${volBreak}
- Divergence: ${divergence}
- FVG: Bull=${marketSMC.bullishFVG} | Bear=${marketSMC.bearishFVG}
- OB: Bull=${marketSMC.bullishOB} | Bear=${marketSMC.bearishOB}
- Kill Zone: ${marketSMC.killzone}
- Liquidation: ${liqData.sentiment}

CRITICAL MATH RULES:
If LONG: entry: "${longEntry}", tp1: "${longTP1}", tp2: "${longTP2}", sl: "${longSL}", rrr: "1:${rrrLong}", leverage: "${longLevText}", margin: "${marginText}", risk: "${riskText}"
If SHORT: entry: "${shortEntry}", tp1: "${shortTP1}", tp2: "${shortTP2}", sl: "${shortSL}", rrr: "1:${rrrShort}", leverage: "${shortLevText}", margin: "${marginText}", risk: "${riskText}"
${strictRule}

CRITICAL LANGUAGE RULES: Write explanations in Sinhala. Mention Score ${finalScore}/${maxScore} and confluences.

Respond ONLY with JSON:
{
  "direction": "LONG or SHORT or WAIT",
  "emoji": "🟢 or 🔴 or ⚪",
  "entry": "Strictly the number provided",
  "tp1": "Strictly the number provided",
  "tp2": "Strictly the number provided",
  "sl": "Strictly the number provided",
  "rrr": "Strictly the RRR provided",
  "leverage": "Strictly the leverage provided",
  "margin": "Strictly the margin provided",
  "risk": "Strictly the risk provided",
  "confidence": "e.g., 90%",
  "trend": "Explain MTF and Score in Sinhala.",
  "smc_summary": "Explain OB, POC, Volume & Liquidation in Sinhala."
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

        // ✅ NEW: Entry warning message
        let entryWarnMsg = entryValidation.warning ? `\n\n${entryValidation.warning}` : "";

        let trackMsg = data.direction !== "WAIT" && data.direction !== "HOLD"
            ? `\n📌 Track කිරීමට .track ලෙස Reply කරන්න.\n[TARGETS|ENTRY:${String(data.entry).replace(/,/g, '')}|TP:${String(data.tp2).replace(/,/g, '')}|SL:${String(data.sl).replace(/,/g, '')}]`
            : "";

        const outMsg = `
╔═══════════════════════════╗
║ 🎯 *PRO SNIPER ANALYSIS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⭐ *Confluence Score: ${finalScore}/${maxScore}*
✔️ Passed: ${finalReasons}
⏱️ Session: ${marketSMC.killzone}${asianWarning}

*🎯 Trade Setup* ${data.emoji} Direction: ${data.direction}

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

*💡 AI Analysis:*
Trend: ${data.trend}
Smart Money: ${data.smc_summary}${entryWarnMsg}

⚡ සටහන: ඔබේ ප්‍රාග්ධනය .margin මගින් යාවත්කාලීන කරන්න.${trackMsg}`;

        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: Analysis ක්‍රියාවලියේ දෝෂයක්. ' + e.message); }
});