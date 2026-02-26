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

        let tradeCategory = "⚡ Scalp Trade";
        if (timeframe === '30m' || timeframe === '1h' || timeframe === '4h') tradeCategory = "🌅 Intraday Trade";
        if (timeframe === '1d' || timeframe === '1w') tradeCategory = "📅 Swing Trade";

        await m.react('⏳');
        await reply(`⏳ *${coin} Full 14-Factor Analysis...*\n(MTF + Whale Walls + Harmonic + True Choppy Detection ⚙️)`);

        const currentCandles = await binance.getKlineData(coin, timeframe, 500);
        const candles5m      = await binance.getKlineData(coin, '5m', 50);   
        const candles1H      = await binance.getKlineData(coin, '1h', 60);
        const candles4H      = await binance.getKlineData(coin, '4h', 60);
        const liqData        = await binance.getLiquidationData(coin);
        const whaleWalls     = await binance.getLiquidityWalls(coin); 
        
        const currentPrice   = parseFloat(currentCandles[currentCandles.length - 1][4]);
        const priceStr       = currentPrice.toFixed(4);

        const ema200 = parseFloat(indicators.calculateEMA(currentCandles, 200));
        const ema1H   = parseFloat(indicators.calculateEMA(candles1H, 50));
        const ema4H   = parseFloat(indicators.calculateEMA(candles4H, 50));
        const trend1H = parseFloat(candles1H[candles1H.length-1][4]) > ema1H ? "Bullish 🟢" : "Bearish 🔴";
        const trend4H = parseFloat(candles4H[candles4H.length-1][4]) > ema4H ? "Bullish 🟢" : "Bearish 🔴";
        const mainTrend  = currentPrice > ema200 ? "Bullish 🟢" : "Bearish 🔴";

        const adxData   = indicators.calculateADX(currentCandles.slice(-50));
        
        // ✅ NEW: True Choppy vs Pullback Detection (MTF Logic)
        const isHTFAligned = (trend1H.includes("Bullish") && trend4H.includes("Bullish")) || (trend1H.includes("Bearish") && trend4H.includes("Bearish"));
        let marketState = "";
        let isTrueChoppy = false;

        if (!adxData.isStrong) { // ADX අඩු නම් (විවේක ගනී නම්)
            if (isHTFAligned) {
                marketState = `CONSOLIDATION ⏳ (${trend4H.includes("Bullish") ? 'Bull Flag' : 'Bear Flag'})`;
            } else {
                marketState = `TRUE CHOPPY ⚖️ (Grid Mode Active)`;
                isTrueChoppy = true;
            }
        } else {
            marketState = `TRENDING 🚀`;
        }

        const rsi       = indicators.calculateRSI(currentCandles.slice(-50), 14);
        const atr       = indicators.calculateATR(currentCandles.slice(-50));
        const macd      = indicators.calculateMACD(currentCandles.slice(-50));
        const vwap      = indicators.calculateVWAP(currentCandles);
        const poc       = indicators.calculatePOC(currentCandles.slice(-50));
        const pattern   = indicators.checkCandlePattern(currentCandles.slice(-10));
        const volBreak  = indicators.checkVolumeBreakout(currentCandles.slice(-50));
        const divergence = indicators.checkDivergence(currentCandles.slice(-50));
        const harmonicPattern = indicators.checkHarmonicPattern(currentCandles.slice(-100));
        const ictSilverBullet = indicators.checkICTSilverBullet(currentCandles.slice(-10));

        const marketSMC = smc.analyzeSMC(currentCandles.slice(-50));
        const atrVal    = parseFloat(atr);
        const direction = mainTrend.includes("Bullish") ? "LONG" : "SHORT";

        const mtf5m = indicators.confirmEntry5m(candles5m, direction);

        const vwapMatch = vwap.match(/\$([0-9.]+)/);
        const vwapPrice = vwapMatch ? parseFloat(vwapMatch[1]) : 0;
        const obForDir  = direction === 'LONG' ? marketSMC.bullishOB : marketSMC.bearishOB;

        const bestEntry = smc.selectBestEntry(priceStr, obForDir, marketSMC.fib618, poc, vwapPrice, direction, atrVal, harmonicPattern);
        const confirmation = smc.checkOBConfirmation(currentCandles.slice(-5), obForDir, direction);
        const orderSuggestion = smc.getOrderTypeSuggestion(bestEntry.price, currentPrice, direction);

        const entryPrice = parseFloat(bestEntry.price);
        let smartSL, tp1, tp2;

        if (direction === 'LONG') {
            const zoneSL = parseFloat(bestEntry.sl);
            const atrSL  = entryPrice - atrVal * 1.5;
            smartSL = (entryPrice - zoneSL) < atrVal * 3 ? zoneSL : atrSL;
            tp1 = (entryPrice + atrVal * 2.5);   
            tp2 = (entryPrice + atrVal * 4.0);   
        } else {
            const zoneSL = parseFloat(bestEntry.sl);
            const atrSL  = entryPrice + atrVal * 1.5;
            smartSL = (zoneSL - entryPrice) < atrVal * 3 ? zoneSL : atrSL;
            tp1 = (entryPrice - atrVal * 2.5);
            tp2 = (entryPrice - atrVal * 4.0);
        }

        const entryStr = entryPrice.toFixed(4);
        const slStr    = parseFloat(smartSL).toFixed(4);
        const tp1Str   = parseFloat(tp1).toFixed(4);
        const tp2Str   = parseFloat(tp2).toFixed(4);
        
        const riskAmount = Math.abs(entryPrice - parseFloat(slStr));
        const rrrVal   = riskAmount > 0 ? (Math.abs(parseFloat(tp2Str) - entryPrice) / riskAmount) : 0;
        const rrrStr   = rrrVal.toFixed(2);

        const settings = await db.getSettings();
        const rrrCheck = indicators.checkRRR(entryStr, tp2Str, slStr, settings.minRRR || 1.5);

        if (!rrrCheck.pass && settings.strictMode && !isTrueChoppy) {
            return await reply(
`⛔ *TRADE REJECTED - RRR Filter*

🪙 ${coin} | ${direction}
📍 Entry: $${entryStr} | TP: $${tp2Str} | SL: $${slStr}

${rrrCheck.reason}
💡 Setup දුර්වලයි. TP zone වෙනස් වෙනකල් wait කරන්න.`
            );
        }

        const userMargin = await db.getMargin(m.sender) || 0;
        let levText = "Set .margin", riskText = "Set .margin", marginText = "Set .margin";
        if (userMargin > 0) {
            const riskAmt   = userMargin * 0.02;
            const deployMgn = userMargin * 0.10;
            const slDist    = Math.abs(entryPrice - parseFloat(slStr)) / entryPrice;
            riskText   = `$${riskAmt.toFixed(2)}`;
            marginText = `$${deployMgn.toFixed(2)}`;
            levText    = `${Math.min(Math.ceil((riskAmt / slDist) / deployMgn), 100)}x (Iso)`;
        }

        let longScore = 0, shortScore = 0, longR = [], shortR = [];

        if (trend4H.includes("Bullish") && trend1H.includes("Bullish")) { longScore++;  longR.push("MTF Bull"); }
        if (trend4H.includes("Bearish") && trend1H.includes("Bearish")) { shortScore++; shortR.push("MTF Bear"); }
        if (currentPrice > ema200 && Math.abs(currentPrice-ema50)/ema50 < 0.003) { longScore++;  longR.push("EMA Pullback"); }
        if (currentPrice < ema200 && Math.abs(currentPrice-ema50)/ema50 < 0.003) { shortScore++; shortR.push("EMA Pullback"); }
        if (marketSMC.bullishOB) { longScore++;  longR.push("Bull OB"); }
        if (marketSMC.bearishOB) { shortScore++; shortR.push("Bear OB"); }
        if (rsi < 45)  { longScore++;  longR.push("RSI Oversold"); }
        if (rsi > 55)  { shortScore++; shortR.push("RSI Overbought"); }
        if (vwap.includes('🟢')) { longScore++;  longR.push("Above VWAP"); }
        if (vwap.includes('🔴')) { shortScore++; shortR.push("Below VWAP"); }
        if (pattern.includes('🟢')) { longScore++;  longR.push(pattern.split(' ')[0]); }
        if (pattern.includes('🔴')) { shortScore++; shortR.push(pattern.split(' ')[0]); }
        if (volBreak.includes("Bullish Breakout"))  { longScore++;  longR.push("Vol Spike"); }
        if (volBreak.includes("Bearish Breakout"))  { shortScore++; shortR.push("Vol Spike"); }
        if (divergence.includes("Bullish")) { longScore++;  longR.push("Divergence"); }
        if (divergence.includes("Bearish")) { shortScore++; shortR.push("Divergence"); }
        if (macd.includes("Bullish")) { longScore++; longR.push("MACD Bull"); }
        if (macd.includes("Bearish")) { shortScore++; shortR.push("MACD Bear"); }
        if (marketSMC.sweep.includes("Bullish") || marketSMC.choch.includes("Bullish")) { longScore++; longR.push("Sweep/ChoCH"); }
        if (marketSMC.sweep.includes("Bearish") || marketSMC.choch.includes("Bearish")) { shortScore++; shortR.push("Sweep/ChoCH"); }
        
        if (confirmation.confirmed) {
            if (direction === 'LONG')  { longScore++;  longR.push("OB Touch ✅"); }
            else                       { shortScore++; shortR.push("OB Touch ✅"); }
        }
        if (mtf5m.confirmed) {
            if (direction === 'LONG')  { longScore++;  longR.push("5m Aligned ✅"); }
            else                       { shortScore++; shortR.push("5m Aligned ✅"); }
        }
        if (harmonicPattern.includes("Bullish")) { longScore++; longR.push(harmonicPattern.split(' ')[1]); }
        if (harmonicPattern.includes("Bearish")) { shortScore++; shortR.push(harmonicPattern.split(' ')[1]); }
        if (ictSilverBullet.includes("Bullish")) { longScore++; longR.push("ICT Time 🎯"); }
        if (ictSilverBullet.includes("Bearish")) { shortScore++; shortR.push("ICT Time 🎯"); }

        const maxScore    = 14; 
        const finalScore  = direction === 'LONG' ? longScore : shortScore;
        const finalReasons = (direction === 'LONG' ? longR : shortR).join(', ') || "None";

        const asianWarning = marketSMC.killzone.includes("Asian") ? "\n⚠️ *ASIAN SESSION* - Fakeout risk ඉහළ. Wait recommended." : "";

        if (settings.strictMode && finalScore < 5 && !isTrueChoppy) {
            return await reply(`⛔ *TRADE REJECTED - Strict Mode* ⛔\n🪙 ${coin} | ${direction}\n⭐ Score: ${finalScore}/${maxScore}\n❌ *හේතුව:* Confluence Score එක ඉතා අඩුයි.`);
        }

        const prompt = `Analyze ${coin} FUTURES. Current: $${priceStr}
[SCORE: ${finalScore}/${maxScore}] Confluences: ${finalReasons}
Market: ${marketState} | Trend: ${mainTrend} | MTF: 4H=${trend4H} 1H=${trend1H}
ADX: ${adxData.status} | RSI: ${rsi} | VWAP: ${vwap}
OB Bull: ${marketSMC.bullishOBDisplay} | OB Bear: ${marketSMC.bearishOBDisplay}
Kill Zone: ${marketSMC.killzone} | Liquidation: ${liqData.sentiment}
Entry Zone: ${bestEntry.name} | Confirmation: ${confirmation.status}

STRICT MATH: direction: "${direction}", entry: "${entryStr}", tp1: "${tp1Str}", tp2: "${tp2Str}", sl: "${slStr}", rrr: "1:${rrrStr}"
Output JSON only: {"direction":"${direction} or WAIT","emoji":"🟢 or 🔴 or ⚪","entry":"${entryStr}","tp1":"${tp1Str}","tp2":"${tp2Str}","sl":"${slStr}","rrr":"1:${rrrStr}","leverage":"${levText}","margin":"${marginText}","risk":"${riskText}","confidence":"XX%","trend":"sinhala","smc_summary":"sinhala"}`;

        const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { Authorization: `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const raw  = aiRes.data.choices[0].message.content.replace(/```(?:json)?\n?/g, '');
        const jm   = raw.match(/\{[\s\S]*\}/);
        if (!jm) throw new Error(`AI JSON error`);
        const data = JSON.parse(jm[0]);

        // ✅ NEW: Grid Generation if True Choppy
        let gridStr = "";
        if (isTrueChoppy) {
            let highs = currentCandles.slice(-50).map(c => parseFloat(c[2]));
            let lows = currentCandles.slice(-50).map(c => parseFloat(c[3]));
            let res = Math.max(...highs), sup = Math.min(...lows);
            let step = (res - sup) / 5;
            gridStr = `\n\n*🕸️ GRID SCALPING ZONES (True Choppy):*\n🔴 Resistance: $${(sup+step*5).toFixed(4)} (Sell Zone)\n🟠 Grid 4: $${(sup+step*4).toFixed(4)}\n🟡 Grid 3: $${(sup+step*3).toFixed(4)} (Neutral)\n🟢 Grid 2: $${(sup+step*2).toFixed(4)}\n🟢 Support: $${sup.toFixed(4)} (Buy Zone)\n_💡 මෙම වෙළඳපොළේ දිශාවක් නොමැති බැවින් Support/Resistance Scalping පමණක් කරන්න._`;
        }

        let extraInfo = gridStr;
        if (harmonicPattern !== "None") extraInfo += `\n📐 *Harmonic PRZ:* ${harmonicPattern}`;
        if (ictSilverBullet !== "Active Time (No FVG)" && ictSilverBullet !== "None") extraInfo += `\n🕒 *ICT Strategy:* ${ictSilverBullet}`;

        const zoneWarn = bestEntry.warning ? `\n\n${bestEntry.warning}` : "";
        const trackMsg = data.direction !== "WAIT" && !isTrueChoppy ? `\n📌 Track: .track reply\n[TARGETS|ENTRY:${data.entry}|TP:${data.tp2}|SL:${data.sl}]` : "";
        
        // ✅ NEW: Danger Warning if Strict Mode is OFF but trade is bad
        let dangerWarning = "";
        if (!settings.strictMode && (finalScore < 5 || !rrrCheck.pass)) {
            dangerWarning = `\n\n🚨 *AI WARNING: DO NOT TAKE THIS TRADE!* 🚨\nමෙම Trade හි Confluence සාධක ඉතා දුර්වලයි (${finalScore}/${maxScore}). මෙය ගැනීමෙන් ඔබේ ප්‍රාග්ධනය අවදානමේ වැටිය හැක. කරුණාකර මෙය Skip කරන්න!`;
        }

        const out = `
╔═══════════════════════════╗
║ 🎯 *PRO SNIPER ANALYSIS* ║
╚═══════════════════════════╝

{dangerWarning}

🪙 ${coin.replace('USDT','')} / USDT  💵 $${priceStr}
📌 *Market State:* ${marketState}
⭐ *Score: ${finalScore}/${maxScore}* ✔️ ${finalReasons}
📊 *ADX Trend:* ${adxData.status}
⏱️ ${marketSMC.killzone}${asianWarning}${extraInfo}

*🔬 5m MTF Confirmation:*
${mtf5m.status}

*🎯 Smart Entry* ${data.emoji} ${data.direction}
🏹 Zone: ${bestEntry.name}
📍 Entry: $${data.entry}
📋 Order: ${orderSuggestion.type}
   ${orderSuggestion.reason}
🔔 ${confirmation.status}

🎯 *Take Profits:*
   ▪️ TP1 (Partial 50%): $${data.tp1}
   ▪️ TP2 (Final 50%):   $${data.tp2}
🛡️ SL (Zone Invalidation): $${data.sl}

*⚖️ Risk Management*
RRR: ${data.rrr} ${rrrCheck.pass ? '✅' : '⚠️'}
⚙️ Leverage: ${data.leverage}
💰 Margin:   ${data.margin}
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
