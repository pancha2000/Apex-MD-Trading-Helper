const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const analyzer = require('../lib/analyzer'); // ✅ අලුත් මොළය සම්බන්ධ කළා
const { checkRRR } = require('../lib/indicators');

cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Ultimate Futures AI - 14-Factor MTF + Harmonic + ICT + Whale Walls + Grid",
    category: "crypto",
    react: "🔴",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ Coin ලබා දෙන්න!\n*උදා:* ${config.PREFIX}future BTC 15m`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key නැහැ!');

        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        let timeframe = args[1] ? args[1].toLowerCase() : '15m';

        await m.react('⏳');
        await reply(`⏳ *${coin} Full 14-Factor Analysis...*\n(MTF + Whale Walls + Harmonic + True Choppy Detection ⚙️)`);

        // 🧠 1. Analyzer එකෙන් Data ගැනීම (කලින් පේළි 100ක වැඩේ එක පේළියෙන්)
        const aData = await analyzer.run14FactorAnalysis(coin, timeframe);
        const liqData = await binance.getLiquidationData(coin);
        const whaleWalls = await binance.getLiquidityWalls(coin);

        // ⚙️ 2. Settings & RRR Filter
        const settings = await db.getSettings();
        const rrrCheck = checkRRR(aData.entryPrice, aData.tp2, aData.sl, settings.minRRR || 1.5);
        
        const riskAmount = Math.abs(parseFloat(aData.entryPrice) - parseFloat(aData.sl));
        const rrrVal = riskAmount > 0 ? (Math.abs(parseFloat(aData.tp2) - parseFloat(aData.entryPrice)) / riskAmount) : 0;
        const rrrStr = rrrVal.toFixed(2);

        if (settings.strictMode && aData.score < 5 && !aData.isTrueChoppy) {
            return await reply(`⛔ *TRADE REJECTED - Strict Mode* ⛔\n🪙 ${coin} | ${aData.direction}\n⭐ Score: ${aData.score}/${aData.maxScore}\n❌ *හේතුව:* Confluence Score එක ඉතා අඩුයි.`);
        }

        if (!rrrCheck.pass && settings.strictMode && !aData.isTrueChoppy) {
            return await reply(`⛔ *TRADE REJECTED - RRR Filter*\n\n🪙 ${coin} | ${aData.direction}\n📍 Entry: $${aData.entryPrice} | TP: $${aData.tp2} | SL: $${aData.sl}\n\n${rrrCheck.reason}\n💡 Setup දුර්වලයි. TP zone වෙනස් වෙනකල් wait කරන්න.`);
        }

        // 💰 3. Position Sizing Calculator
        const userMargin = await db.getMargin(m.sender) || 0;
        let levText = "Set .margin", riskText = "Set .margin", marginText = "Set .margin", qtyText = "Set .margin";
        
        if (userMargin > 0) {
            const riskAmt     = userMargin * 0.02; 
            const deployMgn   = userMargin * 0.10; 
            const slDistPct   = Math.abs(parseFloat(aData.entryPrice) - parseFloat(aData.sl)) / parseFloat(aData.entryPrice);
            const slDistPrice = Math.abs(parseFloat(aData.entryPrice) - parseFloat(aData.sl));
            
            const coinQty = slDistPrice > 0 ? (riskAmt / slDistPrice) : 0;
            const qtyFormatted = coinQty < 1 ? coinQty.toFixed(4) : Math.round(coinQty).toString();

            riskText   = `$${riskAmt.toFixed(2)}`;
            marginText = `$${deployMgn.toFixed(2)}`;
            levText    = `${Math.min(Math.ceil((riskAmt / slDistPct) / deployMgn), 100)}x (Iso)`;
            qtyText    = `${qtyFormatted} ${coin.replace('USDT','')}`;
        }

        // 🤖 4. AI Prompt Generation
        const prompt = `Analyze ${coin} FUTURES. Current: $${aData.priceStr}
[SCORE: ${aData.score}/${aData.maxScore}] Confluences: ${aData.reasons}
Market: ${aData.marketState} | Trend: ${aData.mainTrend} | MTF: 4H=${aData.trend4H} 1H=${aData.trend1H}
ADX: ${aData.adxData.status} | RSI: ${aData.rsi} | VWAP: ${aData.vwap}
OB Bull: ${aData.marketSMC.bullishOBDisplay} | OB Bear: ${aData.marketSMC.bearishOBDisplay}
Kill Zone: ${aData.marketSMC.killzone} | Liquidation: ${liqData.sentiment}
Entry Zone: ${aData.bestEntry.name} | Confirmation: ${aData.confirmation.status}

STRICT MATH: direction: "${aData.direction}", entry: "${aData.entryPrice}", tp1: "${aData.tp1}", tp2: "${aData.tp2}", sl: "${aData.sl}", rrr: "1:${rrrStr}"
Output JSON only: {"direction":"${aData.direction} or WAIT","emoji":"🟢 or 🔴 or ⚪","entry":"${aData.entryPrice}","tp1":"${aData.tp1}","tp2":"${aData.tp2}","sl":"${aData.sl}","rrr":"1:${rrrStr}","leverage":"${levText}","margin":"${marginText}","qty":"${qtyText}","risk":"${riskText}","confidence":"XX%","trend":"sinhala","smc_summary":"sinhala"}`;

        const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { Authorization: `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const raw  = aiRes.data.choices[0].message.content.replace(/```(?:json)?\n?/g, '');
        const jm   = raw.match(/\{[\s\S]*\}/);
        if (!jm) throw new Error(`AI JSON error`);
        const data = JSON.parse(jm[0]);

        // 🕸️ 5. Grid Generation
        let gridStr = "";
        if (aData.isTrueChoppy) {
            let highs = aData.currentCandles.slice(-50).map(c => parseFloat(c[2]));
            let lows = aData.currentCandles.slice(-50).map(c => parseFloat(c[3]));
            let res = Math.max(...highs), sup = Math.min(...lows);
            let step = (res - sup) / 5;
            gridStr = `\n\n*🕸️ GRID SCALPING ZONES (True Choppy):*\n🔴 Resistance: $${(sup+step*5).toFixed(4)} (Sell Zone)\n🟠 Grid 4: $${(sup+step*4).toFixed(4)}\n🟡 Grid 3: $${(sup+step*3).toFixed(4)} (Neutral)\n🟢 Grid 2: $${(sup+step*2).toFixed(4)}\n🟢 Support: $${sup.toFixed(4)} (Buy Zone)\n_💡 මෙම වෙළඳපොළේ දිශාවක් නොමැති බැවින් Support/Resistance Scalping පමණක් කරන්න._`;
        }

        let extraInfo = gridStr;
        if (aData.harmonicPattern !== "None") extraInfo += `\n📐 *Harmonic PRZ:* ${aData.harmonicPattern}`;
        if (aData.ictSilverBullet !== "Active Time (No FVG)" && aData.ictSilverBullet !== "None") extraInfo += `\n🕒 *ICT Strategy:* ${aData.ictSilverBullet}`;

        const zoneWarn = aData.bestEntry.warning ? `\n\n${aData.bestEntry.warning}` : "";
        const trackMsg = data.direction !== "WAIT" && !aData.isTrueChoppy ? `\n📌 Track: .track reply\n[TARGETS|ENTRY:${data.entry}|TP:${data.tp2}|SL:${data.sl}]` : "";
        const asianWarning = aData.marketSMC.killzone.includes("Asian") ? "\n⚠️ *ASIAN SESSION* - Fakeout risk ඉහළ. Wait recommended." : "";
        
        let dangerWarning = "";
        if (!settings.strictMode && (aData.score < 5 || !rrrCheck.pass)) { dangerWarning = `\n\n🚨 *AI WARNING: DO NOT TAKE THIS TRADE!*`; }

        // 🖨️ 6. Output Message
        const out = `
╔═══════════════════════════╗
║ 🎯 *PRO SNIPER ANALYSIS* ║
╚═══════════════════════════╝
${dangerWarning}
🪙 ${coin.replace('USDT','')} / USDT  💵 $${aData.priceStr}
📌 *Market State:* ${aData.marketState}
⭐ *Score: ${aData.score}/${aData.maxScore}* ✔️ ${aData.reasons}
📊 *ADX Trend:* ${aData.adxData.status}
⏱️ ${aData.marketSMC.killzone}${asianWarning}${extraInfo}

*🔬 5m MTF Confirmation:*
${aData.mtf5m.status}

*🎯 Smart Entry* ${data.emoji} ${data.direction}
🏹 Zone: ${aData.bestEntry.name}
📍 Entry: $${data.entry}
📋 Order: ${aData.orderSuggestion.type}
   ${aData.orderSuggestion.reason}
🔔 ${aData.confirmation.status}

🎯 *Take Profits:*
   ▪️ TP1 (Partial 50%): $${data.tp1}
   ▪️ TP2 (Final 50%):   $${data.tp2}
🛡️ SL (Zone Invalidation): $${data.sl}

*⚖️ Risk Management*
RRR: ${data.rrr} ${rrrCheck.pass ? '✅' : '⚠️'}
⚙️ Leverage: ${data.leverage}
💰 Margin:   ${data.margin}
📦 Quantity: ${data.qty}
🛡️ Risk:     ${data.risk}
🔥 Confidence: ${data.confidence}

*🐋 Whale Tracking (Orderbook):*
🟢 Buy Wall (Support): $${whaleWalls.supportWall} (${whaleWalls.supportVol} USDT)
🔴 Sell Wall (Resist): $${whaleWalls.resistWall} (${whaleWalls.resistVol} USDT)

*💡 Analysis:*
${data.trend}
${data.smc_summary}${zoneWarn}

🖼️ Chart: .chart ${coin} ${timeframe}${trackMsg}`;

        await reply(out.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
