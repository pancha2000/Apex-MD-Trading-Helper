const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

cmd({
    pattern: "spot",
    desc: "Ultimate Spot AI with Smart Entry System",
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
        await reply(`⏳ *${coin} Smart Spot Analysis ආරම්භ කෙරේ...*`);

        // ── Data Fetch ──────────────────────────────────────────
        const currentCandles = await binance.getKlineData(coin, timeframe, 100);
        const tf4hCandles    = await binance.getKlineData(coin, '4h', 60);
        const orderBook      = await binance.getOrderBook(coin);
        const fng            = await binance.getFearAndGreed();
        const news           = await binance.getNewsHeadlines();
        const currentPrice   = parseFloat(currentCandles[currentCandles.length - 1][4]);
        const currentPriceStr = currentPrice.toFixed(2);

        // ── Indicators ──────────────────────────────────────────
        const rsi       = indicators.calculateRSI(currentCandles.slice(-50), 14);
        const atr       = indicators.calculateATR(currentCandles.slice(-20));
        const macd      = indicators.calculateMACD(currentCandles.slice(-50));
        const vwap      = indicators.calculateVWAP(currentCandles);
        const poc       = indicators.calculatePOC(currentCandles.slice(-50));
        const breakout  = indicators.checkVolumeBreakout(currentCandles.slice(-50));
        const divergence = indicators.checkDivergence(currentCandles.slice(-50));
        const pattern   = indicators.checkCandlePattern(currentCandles.slice(-5));

        const marketSMC = smc.analyzeSMC(currentCandles.slice(-50));
        const atrVal    = parseFloat(atr);

        // VWAP price parse
        const vwapMatch = vwap.match(/\$([0-9.]+)/);
        const vwapPrice = vwapMatch ? parseFloat(vwapMatch[1]) : 0;

        // ── ✅ Best Entry Zone Select (Spot = always LONG) ───────
        const bestEntry = smc.selectBestEntry(
            currentPriceStr,
            marketSMC.bullishOB,
            marketSMC.fib618,
            poc,
            vwapPrice,
            'LONG',
            atrVal
        );

        // ── ✅ Confirmation Check ─────────────────────────────────
        const confirmation = smc.checkOBConfirmation(
            currentCandles.slice(-5),
            marketSMC.bullishOB,
            'LONG'
        );

        // ── ✅ Order Type Suggestion ──────────────────────────────
        const orderSuggestion = smc.getOrderTypeSuggestion(
            bestEntry.price,
            currentPrice,
            'LONG'
        );

        // ── ✅ Zone-Based SL & TP ─────────────────────────────────
        const entryPrice = parseFloat(bestEntry.price);
        const zoneSL     = parseFloat(bestEntry.sl);
        const atrSL      = entryPrice - atrVal * 2.0;
        // Spot ලෙ SL ටිකක් wider (futures ට වඩා)
        const smartSL    = (entryPrice - zoneSL) < atrVal * 4 ? zoneSL : atrSL;

        const entryStr = entryPrice.toFixed(2);
        const slStr    = parseFloat(smartSL).toFixed(2);

        const resistance = parseFloat(marketSMC.resistance);
        const ext1618    = parseFloat(marketSMC.ext1618);
        const ext2618    = parseFloat(marketSMC.ext2618);

        const spotTP1 = resistance.toFixed(2);
        const spotTP2 = ext1618.toFixed(2);
        const spotTP3 = ext2618.toFixed(2);

        const risk   = Math.abs(entryPrice - parseFloat(slStr));
        const reward = Math.abs(parseFloat(spotTP2) - entryPrice);
        const rrr    = risk > 0 ? (reward / risk).toFixed(2) : "0.00";

        // ── Risk Management ─────────────────────────────────────
        const userMargin = await db.getMargin(m.sender) || 0;
        const settings   = await db.getSettings();
        let allocText = "Set .margin", riskText = "Set .margin";
        if (userMargin > 0) {
            let riskMoney  = userMargin * 0.02;
            let slPercent  = risk / entryPrice;
            let posSize    = riskMoney / slPercent;
            allocText = posSize > userMargin ? `Max $${userMargin} (Full)` : `$${posSize.toFixed(2)}`;
            riskText  = `$${riskMoney.toFixed(2)}`;
        }

        // ── Asian Warning ─────────────────────────────────────────
        const asianWarning = marketSMC.killzone.includes("Asian")
            ? "\n⚠️ *ASIAN SESSION:* Fakeout risk ඉහළයි. London Open දක්වා wait කරන්න." : "";

        let strictRule = settings.strictMode
            ? "If Fakeout, bad RRR, Asian session, output WAIT."
            : "Even if risky, output targets with confidence <50% and STRONG WARNING.";

        // ── AI Prompt ────────────────────────────────────────────
        const prompt = `You are a Master Institutional Crypto Spot Trader. Analyze ${coin} SPOT.
Current Price: $${currentPriceStr} | Session: ${marketSMC.killzone}

[SMART ENTRY SYSTEM]
Best Entry Zone: ${bestEntry.name}
Entry Price: $${entryStr}
Zone Range: $${bestEntry.zoneBottom ? parseFloat(bestEntry.zoneBottom).toFixed(2) : 'N/A'} - $${bestEntry.zoneTop ? parseFloat(bestEntry.zoneTop).toFixed(2) : 'N/A'}
Order Type: ${orderSuggestion.type}
Confirmation: ${confirmation.status}

[DATA]
RSI: ${rsi} | VWAP: ${vwap} | Volume: ${breakout}
Divergence: ${divergence} | Pattern: ${pattern}
MACD: ${macd} | F&G: ${fng}
SMC ChoCH: ${marketSMC.choch} | Sweep: ${marketSMC.sweep}
Bull OB: ${marketSMC.bullishOBDisplay}

MATH RULES (use EXACTLY):
entry: "${entryStr}", tp1: "${spotTP1}", tp2: "${spotTP2}", tp3: "${spotTP3}", sl: "${slStr}", rrr: "1:${rrr}", allocation: "${allocText}", riskAmt: "${riskText}"
${strictRule}

Sinhala explanations. Keep RSI/VWAP/OB/MACD/SMC terms in English.

Respond ONLY with JSON:
{
  "direction": "BUY or WAIT",
  "emoji": "🟢 or ⚪",
  "entry": "${entryStr}",
  "tp1": "${spotTP1}",
  "tp2": "${spotTP2}",
  "tp3": "${spotTP3}",
  "sl": "${slStr}",
  "rrr": "1:${rrr}",
  "allocation": "${allocText}",
  "riskAmt": "${riskText}",
  "confidence": "e.g. 85%",
  "trend": "Trend Sinhala explanation",
  "smc_summary": "Entry zone + OB + Volume Sinhala explanation"
}`;

        const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const raw = aiRes.data.choices[0].message.content.replace(/```(?:json)?\n?/g, '');
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(`AI invalid JSON: ${raw.substring(0, 200)}`);
        let data = JSON.parse(jsonMatch[0]);

        let zoneWarnMsg = bestEntry.warning ? `\n\n${bestEntry.warning}` : "";
        let trackMsg = data.direction !== "WAIT"
            ? `\n📌 Track කිරීමට .track ලෙස Reply කරන්න.\n[TARGETS|ENTRY:${entryStr}|TP:${spotTP2}|SL:${slStr}]`
            : "";

        const outMsg = `
╔═══════════════════════════╗
║  🟢 *PRO SPOT ANALYSIS*  ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
💵 Current Price: $${currentPriceStr}
⏱️ Session: ${marketSMC.killzone}${asianWarning}

*🎯 Smart Entry Setup* ${data.emoji} ${data.direction}

🏹 *Entry Zone:* ${bestEntry.name}
   Zone Range: $${bestEntry.zoneBottom ? parseFloat(bestEntry.zoneBottom).toFixed(2) : 'N/A'} ➜ $${bestEntry.zoneTop ? parseFloat(bestEntry.zoneTop).toFixed(2) : 'N/A'}
📍 *Ideal Entry:* $${data.entry}
📋 *Order Type:* ${orderSuggestion.type}
   ${orderSuggestion.reason}

🔔 *Confirmation:* ${confirmation.status}

🎯 *Take Profits:*
   ▪️ TP 1 (Safe): $${data.tp1}
   ▪️ TP 2 (Main): $${data.tp2}
   ▪️ TP 3 (Moon): $${data.tp3}
🛡️ *Stop Loss:* $${data.sl}
   _(Zone invalidation SL)_

*⚖️ Risk Management (2% Rule)*
Risk/Reward: ${data.rrr}
💰 Investment: ${data.allocation}
🛡️ Max Risk: ${data.riskAmt}
🔥 Confidence: ${data.confidence}

*📊 Institutional Analysis:*
${data.trend}

*🧠 Smart Money:*
${data.smc_summary}${zoneWarnMsg}

⚡ _.margin_ command ලෙස ඔබේ capital set කරන්න.${trackMsg}`;

        await reply(outMsg.trim());
        await m.react('✅');

    } catch (e) {
        console.error('Spot Error:', e.message);
        await reply(`❌ Error: ${e.message}`);
    }
});