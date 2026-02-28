const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');
const binance = require('../lib/binance');
const analyzer = require('../lib/analyzer'); // ✅ අලුත් මොළය සම්බන්ධ කළා
const { checkRRR } = require('../lib/indicators');
const confirmations = require('../lib/confirmations_lib');

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

        // 💰 3. Position Sizing — Binance Risk-Based Formula (matches paper trade exactly)
        const userMargin = await db.getMargin(m.sender) || 0;
        let levText = "Set .margin first", riskText = "—", marginText = "—", qtyText = "—";
        let calcLeverage = 10, calcQty = 0, calcMarginUsed = 0, calcRiskAmt = 0;
        
        if (userMargin > 0) {
            const entryNum  = parseFloat(aData.entryPrice);
            const slNum     = parseFloat(aData.sl);
            const slDist    = Math.abs(entryNum - slNum);
            const slDistPct = slDist / entryNum;

            calcRiskAmt    = userMargin * 0.02;                          // 2% capital risk
            calcQty        = slDist > 0 ? calcRiskAmt / slDist : 0;     // qty from risk
            const rawLev   = slDistPct > 0 ? (calcRiskAmt / slDistPct) / (userMargin * 0.10) : 10;
            calcLeverage   = Math.min(Math.ceil(rawLev), 100);
            calcMarginUsed = calcQty > 0 ? (calcQty * entryNum) / calcLeverage : 0;

            const qtyFmt = calcQty < 1 ? calcQty.toFixed(4) : Math.round(calcQty).toString();
            riskText   = `$${calcRiskAmt.toFixed(2)}`;
            marginText = `$${calcMarginUsed.toFixed(2)}`;
            levText    = `${calcLeverage}x (Iso)`;
            qtyText    = `${qtyFmt} ${coin.replace('USDT','')}`;
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
Liquidity Sweep: ${aData.liquiditySweep} | ChoCH: ${aData.choch}
Short-Term OBs: Bull=${ aData.mtfOBsExtra.bullish ? aData.mtfOBsExtra.bullish.bottom+'-'+aData.mtfOBsExtra.bullish.top : 'None'} | Bear=${aData.mtfOBsExtra.bearish ? aData.mtfOBsExtra.bearish.bottom+'-'+aData.mtfOBsExtra.bearish.top : 'None'}
Entry Validation: ${aData.entryValidation.warning || 'Entry OK ✅'}
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
7. Liquidity Sweep CONFIRMS direction = strong signal (smart money move)
8. ChoCH present = trend reversal confirmed, high confidence
9. If entryValidation has WARNING = reduce confidence, mention in trend field

STRICT OUTPUT RULES:
- Return ONLY a single JSON object, nothing else
- NO markdown, NO backticks, NO explanation text before or after
- All string values: NO newlines, NO unescaped quotes inside strings
- trend/smc_summary/sentiment_note: write in Sinhala but keep it SHORT (max 80 chars each), NO line breaks

EXACT JSON (copy this structure, fill values):
{"direction":"${aData.direction}","emoji":"🟢","entry":"${aData.entryPrice}","tp1":"${aData.tp1}","tp2":"${aData.tp2}","sl":"${aData.sl}","rrr":"1:${rrrStr}","leverage":"${levText}","margin":"${marginText}","qty":"${qtyText}","risk":"${riskText}","confidence":"65%","trend":"Bullish trend short description","smc_summary":"SMC summary one line","sentiment_note":"Sentiment impact one line"}`;
        const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { Authorization: `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        // ─── Ultra-Robust AI JSON Parser ───
        const rawContent = aiRes.data.choices[0].message.content;

        // Step 1: Strip markdown fences
        let raw = rawContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        // Step 2: Extract the outermost { ... } block (greedy - gets the full JSON)
        const braceStart = raw.indexOf('{');
        const braceEnd = raw.lastIndexOf('}');
        if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) {
            console.error('AI raw (no JSON):', rawContent.slice(0, 400));
            throw new Error('AI JSON parse failed - no JSON found');
        }
        let jm = raw.slice(braceStart, braceEnd + 1);

        // Step 3: Try direct parse
        let data;
        try {
            data = JSON.parse(jm);
        } catch(e1) {
            // Step 4: Deep clean - fix common AI JSON mistakes
            let cleaned = jm
                .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')          // unquoted keys
                .replace(/:\s*'([^']*)'/g, ': "$1"')                   // single-quoted values
                .replace(/,\s*([}\]])/g, '$1')                        // trailing commas
                .replace(/[\u0000-\u001F\u007F]/g, ' ')              // control chars
                .replace(/\n/g, ' ').replace(/\r/g, '');              // literal newlines in strings

            // Step 5: Fix broken string values (unescaped quotes inside JSON strings)
            // Rebuild string values field by field using regex
            cleaned = cleaned.replace(/("(?:trend|smc_summary|sentiment_note|confidence|direction|emoji)"\s*:\s*")(.*?)("(?:\s*[,}]))/gs,
                (match, before, val, after) => {
                    const fixedVal = val.replace(/(?<!\\)"/g, '\\"').replace(/\n/g, ' ');
                    return before + fixedVal + after;
                }
            );

            try {
                data = JSON.parse(cleaned);
            } catch(e2) {
                // Step 6: Last resort — extract individual fields with regex
                console.error('AI JSON fallback parsing:', jm.slice(0, 300));
                const extract = (key) => {
                    const m = jm.match(new RegExp('"' + key + '"\\s*:\\s*"([^"\\n]*)"'));
                    return m ? m[1] : null;
                };
                data = {
                    direction: extract('direction') || aData.direction,
                    emoji: extract('emoji') || (aData.direction === 'LONG' ? '🟢' : '🔴'),
                    entry: extract('entry') || aData.entryPrice,
                    tp1: extract('tp1') || aData.tp1,
                    tp2: extract('tp2') || aData.tp2,
                    sl: extract('sl') || aData.sl,
                    rrr: extract('rrr') || ('1:' + rrrStr),
                    leverage: extract('leverage') || levText,
                    margin: extract('margin') || marginText,
                    qty: extract('qty') || qtyText,
                    risk: extract('risk') || riskText,
                    confidence: extract('confidence') || '60%',
                    trend: extract('trend') || 'AI analysis unavailable',
                    smc_summary: extract('smc_summary') || '',
                    sentiment_note: extract('sentiment_note') || sentiment.tradingBias
                };
            }
        }
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
🪙 *${coin.replace('USDT','')} / USDT*  ${data.emoji} *${data.direction}*  💵 $${aData.priceStr}
📌 *Market:* ${aData.marketState} | *ADX:* ${aData.adxData.status}
⏱️ ${aData.marketSMC.killzone}${asianWarning}

━━━━━━━━━━━━━━━━━━
*🎯 TRADE SETUP*
━━━━━━━━━━━━━━━━━━
📍 *Entry:*    $${data.entry}  (${aData.bestEntry.name})
🎯 *TP1:*      $${data.tp1}  _(${aData.tp1Label})_
🎯 *TP2:*      $${data.tp2}  _(${aData.tp2Label})_
🎯 *TP3:*      $${aData.tp3}  _(${aData.tp3Label})_
🛡️ *SL:*       $${data.sl}  _(${aData.slLabel})_
⚖️ *RRR:*      ${data.rrr} ${rrrCheck.pass ? '✅' : '⚠️'}
📋 *Order:*    ${aData.orderSuggestion.type} — ${aData.orderSuggestion.reason}
🔔 ${aData.confirmation.status}${zoneWarn}

━━━━━━━━━━━━━━━━━━
*💼 POSITION SIZE*
━━━━━━━━━━━━━━━━━━
⚙️ Leverage:  ${data.leverage}
💰 Margin:    ${data.margin}
📦 Quantity:  ${data.qty}
🛡️ Risk:       ${data.risk}
🔥 Confidence: ${data.confidence}${extraInfo}

━━━━━━━━━━━━━━━━━━
*📊 TECHNICAL (Score: ${aData.score}/${aData.maxScore})*
━━━━━━━━━━━━━━━━━━
✔️ ${aData.reasons}

*MTF Trend:*  4H=${aData.trend4H} | 1H=${aData.trend1H}
📊 StochRSI:  ${aData.stochRSI.signal} (K:${aData.stochRSI.k})
📉 Bollinger: ${aData.bbands.signal} | %B: ${aData.bbands.percentB}%${aData.bbands.squeeze ? '\n⚡ *BB SQUEEZE* - Breakout imminent!' : ''}
📈 MTF RSI:   ${aData.mtfRSI.display}
📦 Volume:    ${aData.volNodes.display}
🕯️ Candle:    ${aData.candleConf.display}${aData.mtfOB.confluenceZone ? '\n🔥 *MTF OB:* ' + aData.mtfOB.confluenceZone.display : ''}${aData.liquiditySweep !== 'None' ? '\n💧 *Liq Sweep:* ' + aData.liquiditySweep : ''}${aData.choch !== 'None' ? '\n🔄 *ChoCH:* ' + aData.choch : ''}${aData.entryValidation && aData.entryValidation.warning ? '\n' + aData.entryValidation.warning : ''}

*🔬 5m MTF:*
${aData.mtf5m.status}

━━━━━━━━━━━━━━━━━━
*🌊 MARKET CONTEXT*
━━━━━━━━━━━━━━━━━━
🐋 Buy Wall:  $${whaleWalls.supportWall} (${whaleWalls.supportVol} USDT)
🔴 Sell Wall: $${whaleWalls.resistWall} (${whaleWalls.resistVol} USDT)
💸 Funding:   ${fundingRate}
${sentiment.fngEmoji} F&G: ${sentiment.fngValue} (${sentiment.fngLabel}) | ₿ BTC.D: ${sentiment.btcDominance}%
📰 News: ${sentiment.newsSentimentScore > 0 ? '+' : ''}${sentiment.newsSentimentScore} | ${sentimentAligned ? '✅' : '⚠️'} ${sentimentBoost}
💬 ${sentimentNote}

*💡 AI Analysis:*
${data.trend}
${data.smc_summary}

${entryConf.display}

🖼️ .chart ${coin} ${timeframe}${trackMsg}`;

        await reply(out.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
