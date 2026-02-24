const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

cmd({
    pattern: "spot",
    desc: "Ultimate Spot AI - Smart Entry + MTF + RRR Filter",
    category: "crypto",
    react: "🟢",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ Coin ලබා දෙන්න!\n*උදා:* ${config.PREFIX}spot BTC 1d`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key නැහැ!');

        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        let timeframe = args[1] ? args[1].toLowerCase() : '1d';

        await m.react('⏳');
        await reply(`⏳ *${coin} Smart Spot Analysis...*`);

        // ── Data Fetch ─────────────────────────────────────
        const currentCandles = await binance.getKlineData(coin, timeframe, 100);
        const candles4h      = await binance.getKlineData(coin, '4h', 60);
        const candles1h      = await binance.getKlineData(coin, '1h', 50);    // ✅ Feature 1: MTF
        const fng            = await binance.getFearAndGreed();
        const currentPrice   = parseFloat(currentCandles[currentCandles.length-1][4]);
        const priceStr       = currentPrice.toFixed(2);

        // ── Indicators ─────────────────────────────────────
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

        // ✅ Feature 1: 1H MTF Confirmation (Spot ලෙ 5m too short, 1H better)
        const mtf1h = indicators.confirmEntry5m(candles1h, 'LONG'); // reuse function

        // ── Smart Entry ─────────────────────────────────────
        const vwapMatch = vwap.match(/\$([0-9.]+)/);
        const vwapPrice = vwapMatch ? parseFloat(vwapMatch[1]) : 0;
        const bestEntry = smc.selectBestEntry(priceStr, marketSMC.bullishOB, marketSMC.fib618, poc, vwapPrice, 'LONG', atrVal);
        const confirmation = smc.checkOBConfirmation(currentCandles.slice(-5), marketSMC.bullishOB, 'LONG');
        const orderSugg = smc.getOrderTypeSuggestion(bestEntry.price, currentPrice, 'LONG');

        // ── Zone SL & TPs ───────────────────────────────────
        const entryPrice = parseFloat(bestEntry.price);
        const zoneSL     = parseFloat(bestEntry.sl);
        const atrSL      = entryPrice - atrVal * 2.0;
        const smartSL    = (entryPrice - zoneSL) < atrVal * 4 ? zoneSL : atrSL;

        const entryStr = entryPrice.toFixed(2);
        const slStr    = parseFloat(smartSL).toFixed(2);
        const tp1      = parseFloat(marketSMC.resistance).toFixed(2);       // ✅ Partial TP1
        const tp2      = parseFloat(marketSMC.ext1618).toFixed(2);          // Main TP
        const tp3      = parseFloat(marketSMC.ext2618).toFixed(2);

        const risk   = Math.abs(entryPrice - parseFloat(slStr));
        const reward = Math.abs(parseFloat(tp2) - entryPrice);
        const rrrVal = risk > 0 ? reward / risk : 0;
        const rrrStr = rrrVal.toFixed(2);

        // ✅ Feature 2: RRR Pre-Filter
        const settings = await db.getSettings();
        const rrrCheck = indicators.checkRRR(entryStr, tp2, slStr, settings.minRRR || 1.5);

        if (!rrrCheck.pass && settings.strictMode) {
            return await reply(
`⛔ *SPOT TRADE REJECTED - RRR Filter*

🪙 ${coin} | BUY
📍 Entry: $${entryStr} | TP: $${tp2} | SL: $${slStr}

${rrrCheck.reason}

💡 Better entry zone ලෙ wait කරන්න.`
            );
        }

        // ── Risk Sizing ─────────────────────────────────────
        const userMargin = await db.getMargin(m.sender) || 0;
        let allocText = "Set .margin", riskText = "Set .margin";
        if (userMargin > 0) {
            const riskMon  = userMargin * 0.02;
            const slPct    = risk / entryPrice;
            const posSize  = riskMon / slPct;
            allocText = posSize > userMargin ? `Max $${userMargin}` : `$${posSize.toFixed(2)}`;
            riskText  = `$${riskMon.toFixed(2)}`;
        }

        const asianWarn = marketSMC.killzone.includes("Asian")
            ? "\n⚠️ *ASIAN SESSION* - London Open ලෙ wait recommended." : "";

        const prompt = `Analyze ${coin} SPOT trading. Current: $${priceStr}

1H MTF: ${mtf1h.status}
RRR: ${rrrCheck.reason}
Session: ${marketSMC.killzone}

DATA: RSI=${rsi} | VWAP=${vwap} | Volume=${breakout}
Divergence=${divergence} | Pattern=${pattern} | F&G=${fng}
OB Bull: ${marketSMC.bullishOBDisplay} | ChoCH: ${marketSMC.choch}

Entry Zone: ${bestEntry.name} | Order: ${orderSugg.type}
Confirmation: ${confirmation.status}

EXACT MATH:
entry:"${entryStr}", tp1:"${tp1}", tp2:"${tp2}", tp3:"${tp3}", sl:"${slStr}", rrr:"1:${rrrStr}", allocation:"${allocText}", riskAmt:"${riskText}"

${settings.strictMode ? 'Output WAIT if low confidence or bad setup.' : 'Output signal with warnings if needed.'}
Sinhala explanation. Keep RSI/VWAP/OB in English.

JSON only:
{"direction":"BUY or WAIT","emoji":"🟢 or ⚪","entry":"${entryStr}","tp1":"${tp1}","tp2":"${tp2}","tp3":"${tp3}","sl":"${slStr}","rrr":"1:${rrrStr}","allocation":"${allocText}","riskAmt":"${riskText}","confidence":"XX%","trend":"sinhala","smc_summary":"sinhala"}`;

        const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { Authorization: `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const raw  = aiRes.data.choices[0].message.content.replace(/```(?:json)?\n?/g, '');
        const jm   = raw.match(/\{[\s\S]*\}/);
        if (!jm) throw new Error(`AI JSON error: ${raw.substring(0,150)}`);
        const data = JSON.parse(jm[0]);

        const zoneWarn   = bestEntry.warning  ? `\n\n${bestEntry.warning}` : "";
        const rrrWarnMsg = !rrrCheck.pass     ? `\n\n⚠️ *RRR WARNING:* ${rrrCheck.reason}` : "";
        const trackMsg   = data.direction !== "WAIT"
            ? `\n📌 Track: .track reply\n[TARGETS|ENTRY:${entryStr}|TP:${tp2}|SL:${slStr}]` : "";

        const out = `
╔═══════════════════════════╗
║  🟢 *PRO SPOT ANALYSIS*  ║
╚═══════════════════════════╝

🪙 ${coin.replace('USDT','')} / USDT  💵 $${priceStr}
⏱️ ${marketSMC.killzone}${asianWarn}

*🔬 1H MTF Confirmation:*
${mtf1h.status}

*🎯 Smart Entry* ${data.emoji} ${data.direction}
🏹 Zone: ${bestEntry.name}
   $${parseFloat(bestEntry.zoneBottom||0).toFixed(2)} ➜ $${parseFloat(bestEntry.zoneTop||0).toFixed(2)}
📍 Entry: $${data.entry}
📋 Order: ${orderSugg.type}
   ${orderSugg.reason}
🔔 ${confirmation.status}

🎯 *Take Profits:*
   ▪️ TP1 (Partial 50%): $${data.tp1}
   ▪️ TP2 (Main 50%):    $${data.tp2}
   ▪️ TP3 (Moon):        $${data.tp3}
🛡️ SL (Zone Invalidation): $${data.sl}

*⚖️ Risk Management (2% Rule)*
RRR: ${data.rrr} ${rrrCheck.pass ? '✅' : '⚠️'}
💰 Investment: ${data.allocation}
🛡️ Max Risk:   ${data.riskAmt}
🔥 Confidence: ${data.confidence}

*📊 Analysis:*
${data.trend}
${data.smc_summary}${zoneWarn}${rrrWarnMsg}

⚡ _.margin_ ලෙ capital set කරන්න.${trackMsg}`;

        await reply(out.trim());
        await m.react('✅');
    } catch (e) {
        console.error('Spot Error:', e.message);
        await reply(`❌ Error: ${e.message}`);
    }
});