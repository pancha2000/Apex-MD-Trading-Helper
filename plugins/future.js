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
    desc: "Ultimate Futures AI with Smart Entry System",
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
        await reply(`⏳ *${coin} Smart Entry Analysis ආරම්භ කෙරේ...*`);

        // ── Data Fetch ──────────────────────────────────────────
        const currentCandles = await binance.getKlineData(coin, timeframe, 200);
        const candles1H = await binance.getKlineData(coin, '1h', 60);
        const candles4H = await binance.getKlineData(coin, '4h', 60);
        const liqData = await binance.getLiquidationData(coin);
        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]);
        const currentPriceStr = currentPrice.toFixed(2);

        // ── Indicators ──────────────────────────────────────────
        const ema200 = parseFloat(indicators.calculateEMA(currentCandles, 200));
        const ema50  = parseFloat(indicators.calculateEMA(currentCandles.slice(-100), 50));
        const ema21  = parseFloat(indicators.calculateEMA(currentCandles.slice(-50), 21));

        const mainTrend  = currentPrice > ema200 ? "Bullish (Uptrend) 🟢" : "Bearish (Downtrend) 🔴";
        const isChoppy   = Math.abs(ema50 - ema21) / ema50 < 0.0015;
        const marketState = isChoppy ? "CHOPPY / SIDEWAYS ⚠️" : "TRENDING 🚀";

        const ema1H   = parseFloat(indicators.calculateEMA(candles1H, 50));
        const ema4H   = parseFloat(indicators.calculateEMA(candles4H, 50));
        const trend1H = parseFloat(candles1H[candles1H.length - 1][4]) > ema1H ? "Bullish 🟢" : "Bearish 🔴";
        const trend4H = parseFloat(candles4H[candles4H.length - 1][4]) > ema4H ? "Bullish 🟢" : "Bearish 🔴";
        const mtfTrend = `4H: ${trend4H} | 1H: ${trend1H}`;

        const rsi       = indicators.calculateRSI(currentCandles.slice(-50), 14);
        const atr       = indicators.calculateATR(currentCandles.slice(-50));
        const macd      = indicators.calculateMACD(currentCandles.slice(-50));
        const vwap      = indicators.calculateVWAP(currentCandles);
        const poc       = indicators.calculatePOC(currentCandles.slice(-50));
        const pattern   = indicators.checkCandlePattern(currentCandles.slice(-10));
        const volBreak  = indicators.checkVolumeBreakout(currentCandles.slice(-50));
        const divergence = indicators.checkDivergence(currentCandles.slice(-50));

        const marketSMC = smc.analyzeSMC(currentCandles.slice(-50));
        const atrVal    = parseFloat(atr);

        // VWAP price parse
        const vwapMatch = vwap.match(/\$([0-9.]+)/);
        const vwapPrice = vwapMatch ? parseFloat(vwapMatch[1]) : 0;

        // ── Direction ───────────────────────────────────────────
        const direction = mainTrend.includes("Bullish") ? "LONG" : "SHORT";

        // ── ✅ FIX 5: Best Entry Zone Select ────────────────────
        const obForDir = direction === 'LONG' ? marketSMC.bullishOB : marketSMC.bearishOB;
        const bestEntry = smc.selectBestEntry(
            currentPriceStr,
            obForDir,
            marketSMC.fib618,
            poc,
            vwapPrice,
            direction,
            atrVal
        );

        // ── ✅ FIX 2: Confirmation Check ─────────────────────────
        const confirmation = smc.checkOBConfirmation(
            currentCandles.slice(-5),
            obForDir,
            direction
        );

        // ── ✅ FIX 4: Order Type Suggestion ──────────────────────
        const orderSuggestion = smc.getOrderTypeSuggestion(
            bestEntry.price,
            currentPrice,
            direction
        );

        // ── ✅ FIX 3: SL from Zone (not just ATR) ───────────────
        // OB zone ඇත්නම් zone-based SL, නැත්නම් ATR fallback
        const entryPrice = parseFloat(bestEntry.price);
        let smartSL, longTP1, longTP2, shortTP1, shortTP2, rrr;

        if (direction === 'LONG') {
            // Zone SL vs ATR SL - whichever is more logical
            const zoneSL = parseFloat(bestEntry.sl);
            const atrSL  = entryPrice - atrVal * 1.5;
            // Zone SL ඉතා দূরে නැත්නම් (>3 ATR) use zone SL
            smartSL = (entryPrice - zoneSL) < atrVal * 3 ? zoneSL : atrSL;
            longTP1 = (entryPrice + atrVal * 2.5).toFixed(2);
            longTP2 = (entryPrice + atrVal * 4.0).toFixed(2);
            rrr = ((parseFloat(longTP2) - entryPrice) / (entryPrice - smartSL)).toFixed(2);
        } else {
            const zoneSL = parseFloat(bestEntry.sl);
            const atrSL  = entryPrice + atrVal * 1.5;
            smartSL = (zoneSL - entryPrice) < atrVal * 3 ? zoneSL : atrSL;
            shortTP1 = (entryPrice - atrVal * 2.5).toFixed(2);
            shortTP2 = (entryPrice - atrVal * 4.0).toFixed(2);
            rrr = ((entryPrice - parseFloat(shortTP2)) / (smartSL - entryPrice)).toFixed(2);
        }

        const entryStr = entryPrice.toFixed(2);
        const slStr    = parseFloat(smartSL).toFixed(2);
        const tp1Str   = direction === 'LONG' ? longTP1 : shortTP1;
        const tp2Str   = direction === 'LONG' ? longTP2 : shortTP2;

        // ── Risk Management ─────────────────────────────────────
        const userMargin = await db.getMargin(m.sender) || 0;
        const settings   = await db.getSettings();
        let levText = "Set .margin", riskText = "Set .margin", marginText = "Set .margin";
        if (userMargin > 0) {
            let riskAmount     = userMargin * 0.02;
            let deployedMargin = userMargin * 0.10;
            let slDistance     = Math.abs(entryPrice - parseFloat(slStr)) / entryPrice;
            riskText    = `$${riskAmount.toFixed(2)}`;
            marginText  = `$${deployedMargin.toFixed(2)}`;
            levText     = `${Math.min(Math.ceil((riskAmount / slDistance) / deployedMargin), 100)}x (Iso)`;
        }

        // ── Confluence Score ─────────────────────────────────────
        let longScore = 0, shortScore = 0;
        let longReasons = [], shortReasons = [];

        if (trend4H.includes("Bullish") && trend1H.includes("Bullish")) { longScore++;  longReasons.push("MTF Bullish"); }
        if (trend4H.includes("Bearish") && trend1H.includes("Bearish")) { shortScore++; shortReasons.push("MTF Bearish"); }
        if (currentPrice > ema200 && Math.abs(currentPrice - ema50) / ema50 < 0.003) { longScore++;  longReasons.push("EMA Pullback"); }
        if (currentPrice < ema200 && Math.abs(currentPrice - ema50) / ema50 < 0.003) { shortScore++; shortReasons.push("EMA Pullback"); }
        if (marketSMC.bullishOB) { longScore++;  longReasons.push("Bullish OB"); }
        if (marketSMC.bearishOB) { shortScore++; shortReasons.push("Bearish OB"); }
        if (rsi < 35)  { longScore++;  longReasons.push("RSI Oversold"); }
        if (rsi > 65)  { shortScore++; shortReasons.push("RSI Overbought"); }
        if (vwap.includes('🟢')) { longScore++;  longReasons.push("Above VWAP"); }
        if (vwap.includes('🔴')) { shortScore++; shortReasons.push("Below VWAP"); }
        if (pattern.includes('🟢')) { longScore++;  longReasons.push("Candle Pattern"); }
        if (pattern.includes('🔴')) { shortScore++; shortReasons.push("Candle Pattern"); }
        if (volBreak.includes("Bullish Breakout"))  { longScore++;  longReasons.push("Vol Breakout"); }
        if (volBreak.includes("Bearish Breakout"))  { shortScore++; shortReasons.push("Vol Breakout"); }
        if (divergence.includes("Bullish")) { longScore++;  longReasons.push("Bullish Divergence"); }
        if (divergence.includes("Bearish")) { shortScore++; shortReasons.push("Bearish Divergence"); }
        if (confirmation.confirmed) {
            if (direction === 'LONG')  { longScore++;  longReasons.push("OB Confirmed ✅"); }
            if (direction === 'SHORT') { shortScore++; shortReasons.push("OB Confirmed ✅"); }
        }

        const maxScore    = 9;
        const finalScore  = direction === 'LONG' ? longScore : shortScore;
        let   finalReasons = direction === 'LONG' ? longReasons.join(', ') : shortReasons.join(', ');
        if (!finalReasons) finalReasons = "None matched";

        // ── Asian Session Warning ────────────────────────────────
        const asianWarning = marketSMC.killzone.includes("Asian")
            ? "\n⚠️ *ASIAN SESSION:* Fakeout risk ඉහළයි. London/NY session දක්වා wait කරන්න." : "";

        // ── AI Prompt ────────────────────────────────────────────
        let strictRule = settings.strictMode
            ? "If Score < 4 or CHOPPY market or Asian session, output WAIT."
            : "Even if score is low, output targets with confidence <50% and strong WARNING.";

        const prompt = `You are a Master Crypto AI. Analyze ${coin} FUTURES.
Current Price: $${currentPriceStr}

[CONFLUENCE SCORE: ${finalScore}/${maxScore}]
Passed: ${finalReasons}

[SMART ENTRY SYSTEM]
Best Entry Zone: ${bestEntry.name}
Entry Price: $${entryStr} (Zone: $${bestEntry.zoneBottom ? bestEntry.zoneBottom.toFixed ? bestEntry.zoneBottom.toFixed(2) : bestEntry.zoneBottom : 'N/A'} - $${bestEntry.zoneTop ? bestEntry.zoneTop.toFixed ? bestEntry.zoneTop.toFixed(2) : bestEntry.zoneTop : 'N/A'})
Order Type: ${orderSuggestion.type}
Confirmation: ${confirmation.status}

[MARKET DATA]
Market: ${marketState} | Trend: ${mainTrend} | MTF: ${mtfTrend}
RSI: ${rsi} | VWAP: ${vwap} | Volume: ${volBreak}
Divergence: ${divergence} | Kill Zone: ${marketSMC.killzone}
OB Bull: ${marketSMC.bullishOBDisplay} | OB Bear: ${marketSMC.bearishOBDisplay}
Liquidation: ${liqData.sentiment}

MATH RULES (use EXACTLY these numbers):
Direction: ${direction}
entry: "${entryStr}", tp1: "${tp1Str}", tp2: "${tp2Str}", sl: "${slStr}"
rrr: "1:${rrr}", leverage: "${levText}", margin: "${marginText}", risk: "${riskText}"
${strictRule}

Sinhala explanations. Keep RSI/VWAP/OB/MACD/SMC terms in English.

Respond ONLY with JSON:
{
  "direction": "${direction} or WAIT",
  "emoji": "🟢 or 🔴 or ⚪",
  "entry": "${entryStr}",
  "tp1": "${tp1Str}",
  "tp2": "${tp2Str}",
  "sl": "${slStr}",
  "rrr": "1:${rrr}",
  "leverage": "${levText}",
  "margin": "${marginText}",
  "risk": "${riskText}",
  "confidence": "e.g. 85%",
  "trend": "MTF + Score Sinhala explanation",
  "smc_summary": "Entry zone + OB + Liquidation Sinhala explanation"
}`;

        const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const raw = aiRes.data.choices[0].message.content.replace(/```(?:json)?\n?/g, '');
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(`AI invalid JSON: ${raw.substring(0, 200)}`);
        let data = JSON.parse(jsonMatch[0]);

        // ── Zone Warning ──────────────────────────────────────────
        let zoneWarnMsg = bestEntry.warning ? `\n\n${bestEntry.warning}` : "";

        // ── Track Message ─────────────────────────────────────────
        let trackMsg = data.direction !== "WAIT"
            ? `\n📌 Track කිරීමට .track ලෙස Reply කරන්න.\n[TARGETS|ENTRY:${entryStr}|TP:${tp2Str}|SL:${slStr}]`
            : "";

        // ── Output ───────────────────────────────────────────────
        const outMsg = `
╔═══════════════════════════╗
║ 🎯 *PRO SNIPER ANALYSIS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
💵 Current Price: $${currentPriceStr}
⭐ *Confluence: ${finalScore}/${maxScore}* | ✔️ ${finalReasons}
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
🛡️ *Stop Loss:* $${data.sl}
   _(Zone invalidation SL)_

*⚖️ Risk Management (2% Risk)*
Risk/Reward: ${data.rrr}
⚙️ Leverage: ${data.leverage}
💰 Margin: ${data.margin}
🛡️ Max Risk: ${data.risk}
🔥 Confidence: ${data.confidence}

*💡 AI Analysis:*
${data.trend}

*📊 Smart Money:*
${data.smc_summary}${zoneWarnMsg}

⚡ _.margin_ command ලෙස ඔබේ capital set කරන්න.${trackMsg}`;

        await reply(outMsg.trim());
        await m.react('✅');

    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});