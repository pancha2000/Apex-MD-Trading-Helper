const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const analyzer = require('../lib/analyzer'); // ✅ අලුත් මොළය සම්බන්ධ කළා
const { checkRRR } = require('../lib/indicators');
const confirmations = require('../lib/confirmations_lib.js');

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
        // 🌐 Parallel fetch - all external data එකවර ගන්නවා (speed)
        const [liqData, whaleWalls, fundingRate, sentiment] = await Promise.all([
            binance.getLiquidationData(coin),
            binance.getLiquidityWalls(coin),
            binance.getFundingRate(coin),
            binance.getMarketSentiment(coin),
        ]);

        // 🔬 8-Factor Advanced Entry Confirmation (parallel, non-blocking)
        const entryConf = await confirmations.runAllConfirmations(
            coin, aData.direction, config.LUNAR_API || null
        );

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

        // ✅ Sentiment Confirmation
        const sentimentBoost = parseFloat(sentiment.totalBias) > 1 ? '✅ CONFIRMED (Sentiment aligned)' :
                               parseFloat(sentiment.totalBias) < -1 ? '⛔ CONFLICTING (Sentiment against)' : '⚠️ NEUTRAL';
        const sentimentAligned = 
            (aData.direction === 'LONG' && parseFloat(sentiment.totalBias) >= 0.5) ||
            (aData.direction === 'SHORT' && parseFloat(sentiment.totalBias) <= -0.5);

        // 🤖 4. Enhanced AI Prompt (Sentiment + Technical combined)
        const headlineStr = sentiment.newsHeadlines.slice(0,3).join(' | ');
        const prompt = `Analyze ${coin} FUTURES trade signal. Current: $${aData.priceStr}

=== TECHNICAL (${aData.maxScore}-FACTOR SCORE: ${aData.score}/${aData.maxScore}) ===
Confluences: ${aData.reasons}
Market: ${aData.marketState} | Trend: ${aData.mainTrend} | MTF: 4H=${aData.trend4H} 1H=${aData.trend1H}
ADX: ${aData.adxData.status} | RSI: ${aData.rsi} | VWAP: ${aData.vwap}
OB Bull: ${aData.marketSMC.bullishOBDisplay} | OB Bear: ${aData.marketSMC.bearishOBDisplay}
Kill Zone: ${aData.marketSMC.killzone} | Liquidation: ${liqData.sentiment}
Entry Zone: ${aData.bestEntry.name} | OB Confirmation: ${aData.confirmation.status}
StochRSI: ${aData.stochRSI.signal} (K:${aData.stochRSI.k}) | BB: ${aData.bbands.signal} | MTF OB: ${aData.mtfOB.confluenceZone ? aData.mtfOB.confluenceZone.display : 'None'}
Smart SL Method: ${aData.slLabel} | TP Methods: ${aData.tp1Label}, ${aData.tp2Label}, ${aData.tp3Label}
MTF RSI: ${aData.mtfRSI.signal} | Volume Node: ${aData.volNodes.nearHVN ? 'At HVN (good entry)' : 'Not at HVN'} 
Session: ${aData.session.quality} (${aData.session.session}) | Candle Close: ${aData.candleConf.confirmed ? 'CONFIRMED' : 'Pending'}
Funding Rate: ${fundingRate} | Whale Buy Wall: $${whaleWalls.supportWall} | Sell: $${whaleWalls.resistWall}

=== SENTIMENT LAYER (USE THIS TO CONFIRM/REJECT) ===
Fear & Greed: ${sentiment.fngValue}/100 (${sentiment.fngLabel})
BTC Dominance: ${sentiment.btcDominance}% (>55% alts suffer, <45% altseason)
News Sentiment Score: ${sentiment.newsSentimentScore} (-5 bearish to +5 bullish)
Coin-specific news hits: ${sentiment.coinNewsHits}
Latest Headlines: ${headlineStr}
Overall Market Bias: ${sentiment.overallSentiment}
Sentiment vs Technical Signal: ${sentimentBoost}

=== ENTRY CONFIRMATION SCORE ===
Advanced 8-Factor Score: ${entryConf.totalScore >= 0 ? '+' : ''}${entryConf.totalScore} (${entryConf.confirmationStrength})
Stablecoin Flow: ${entryConf.usdtDom.signal} | OI Change: ${entryConf.oiChange.signal}
CVD: ${entryConf.cvd.signal} | BTC Correlation: ${entryConf.btcCorr.signal}
Put/Call Ratio: ${entryConf.pcr.signal} | Netflow: ${entryConf.netflow.signal}

=== AI DECISION RULES ===
1. If sentiment CONFLICTS with tech direction, lower confidence by 20% and warn
2. If sentiment CONFIRMS tech direction, boost confidence by 10%
3. Funding >0.1% + LONG = caution (longs getting squeezed)
4. Funding <-0.1% + SHORT = caution (shorts getting squeezed)
5. F&G >80 (Extreme Greed) + LONG = risky, mention
6. F&G <20 (Extreme Fear) + SHORT = risky, mention

STRICT MATH (keep exactly): entry:"${aData.entryPrice}", tp1:"${aData.tp1}", tp2:"${aData.tp2}", sl:"${aData.sl}", rrr:"1:${rrrStr}"

JSON ONLY: {"direction":"${aData.direction} or WAIT","emoji":"🟢 or 🔴 or ⚪","entry":"${aData.entryPrice}","tp1":"${aData.tp1}","tp2":"${aData.tp2}","sl":"${aData.sl}","rrr":"1:${rrrStr}","leverage":"${levText}","margin":"${marginText}","qty":"${qtyText}","risk":"${riskText}","confidence":"XX%","trend":"sinhala 2 lines max","smc_summary":"sinhala 1 line","sentiment_note":"sinhala 1 line on news/sentiment impact on this trade"}`;
        const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { Authorization: `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const raw  = aiRes.data.choices[0].message.content.replace(/```(?:json)?\n?/g, '');
        const jm   = raw.match(/\{[\s\S]*\}/);
        if (!jm) throw new Error(`AI JSON error`);
        const data = JSON.parse(jm[0]);
        const sentimentNote = data.sentiment_note || sentiment.tradingBias;

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
        const sessionWarn = aData.session.quality === 'AVOID' 
            ? "\n🔴 *OFF-HOURS* - Very low volume. Avoid new entries."
            : aData.session.quality === 'CAUTION'
                ? "\n⚠️ *ASIAN SESSION* - Low volume, fakeout risk. Wait for London (08:00 UTC)."
                : "";
        const asianWarning = sessionWarn;
        
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

*📐 Entry Confirmation Suite:*
📊 StochRSI: ${aData.stochRSI.signal} (K:${aData.stochRSI.k})
📉 Bollinger: ${aData.bbands.signal} | %B: ${aData.bbands.percentB}%${aData.bbands.squeeze ? '\n⚡ *BB SQUEEZE* - Breakout imminent!' : ''}
📈 MTF RSI: ${aData.mtfRSI.display}
🕒 Session: ${aData.session.display}
📦 Volume: ${aData.volNodes.display}
🕯️ Candle: ${aData.candleConf.display}${aData.mtfOB.confluenceZone ? '\n🔥 *MTF OB:* ' + aData.mtfOB.confluenceZone.display : ''}

*🎯 Smart Entry* ${data.emoji} ${data.direction}
🏹 Zone: ${aData.bestEntry.name}
📍 Entry: $${data.entry}
📋 Order: ${aData.orderSuggestion.type}
   ${aData.orderSuggestion.reason}
🔔 ${aData.confirmation.status}

🎯 *Take Profits:*
   ▪️ TP1 (33% - ${aData.tp1Label}): $${data.tp1}
   ▪️ TP2 (33% - ${aData.tp2Label}): $${data.tp2}
   ▪️ TP3 (34% - ${aData.tp3Label}): $${aData.tp3}
🛡️ SL (${aData.slLabel}): $${data.sl}

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
💸 Funding Rate: ${fundingRate}

*🧠 Sentiment Layer:*
${sentiment.fngEmoji} F&G: ${sentiment.fngValue} (${sentiment.fngLabel})
₿ BTC.D: ${sentiment.btcDominance}%  📰 News Score: ${sentiment.newsSentimentScore > 0 ? '+' : ''}${sentiment.newsSentimentScore}
${sentimentAligned ? '✅' : '⚠️'} Signal vs Market: ${sentimentBoost}
💬 ${sentimentNote}

*💡 Analysis:*
${data.trend}
${data.smc_summary}${zoneWarn}

${entryConf.display}

🖼️ Chart: .chart ${coin} ${timeframe}${trackMsg}`;

        await reply(out.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
