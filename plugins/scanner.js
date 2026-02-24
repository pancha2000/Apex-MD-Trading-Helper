const axios = require('axios');
const { Trade, getSettings } = require('./database');
const config = require('../config');

function startScanner(conn) {
    console.log('🔄 Advanced Background Scanner Started...');

    // ================= 1. TP/SL & TRAILING SL SCANNER (Every 1 Min) =================
    setInterval(async () => {
        try {
            const settings = await getSettings();
            const activeTrades = await Trade.find({ status: 'active' });
            if (!activeTrades || activeTrades.length === 0) return;

            for (let trade of activeTrades) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`);
                    const currentPrice = parseFloat(res.data.price);
                    let alertMsg = "";
                    let tradeFinished = false;
                    const isLong = trade.tp > trade.entry;

                    // Trailing SL Logic
                    if (settings.trailingSl) {
                        const halfWay = trade.entry + ((trade.tp - trade.entry) / 2);
                        if (isLong && currentPrice >= halfWay && trade.sl < trade.entry) {
                            trade.sl = trade.entry;
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `🛡️ *TRAILING SL ACTIVATED!*\n\n🪙 *${trade.coin}* (LONG)\nමාකට් එක 50% ක් ලාභයි. Stop Loss එක Entry ($${trade.entry}) මට්ටමට ගෙන ආවා. දැන් Trade එක Risk-Free! 🎉` });
                        } else if (!isLong && currentPrice <= halfWay && trade.sl > trade.entry) {
                            trade.sl = trade.entry;
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `🛡️ *TRAILING SL ACTIVATED!*\n\n🪙 *${trade.coin}* (SHORT)\nමාකට් එක 50% ක් ලාභයි. Stop Loss එක Entry ($${trade.entry}) මට්ටමට ගෙන ආවා. දැන් Trade එක Risk-Free! 🎉` });
                        }
                    }

                    // TP / SL Check
                    if (isLong) {
                        if (currentPrice >= trade.tp) { alertMsg = `✅ *TAKE PROFIT HIT!* 🎉\n🪙 *${trade.coin}* (LONG)\n💰 Target: $${trade.tp}\n💵 Current: $${currentPrice}`; tradeFinished = true; }
                        else if (currentPrice <= trade.sl) { alertMsg = `⚠️ *STOP LOSS HIT!* 🛑\n🪙 *${trade.coin}* (LONG)\n📉 SL: $${trade.sl}\n💵 Current: $${currentPrice}`; tradeFinished = true; }
                    } else {
                        if (currentPrice <= trade.tp) { alertMsg = `✅ *TAKE PROFIT HIT!* 🎉\n🪙 *${trade.coin}* (SHORT)\n💰 Target: $${trade.tp}\n💵 Current: $${currentPrice}`; tradeFinished = true; }
                        else if (currentPrice >= trade.sl) { alertMsg = `⚠️ *STOP LOSS HIT!* 🛑\n🪙 *${trade.coin}* (SHORT)\n📉 SL: $${trade.sl}\n💵 Current: $${currentPrice}`; tradeFinished = true; }
                    }

                    if (tradeFinished && alertMsg !== "") {
                        await conn.sendMessage(trade.userJid, { text: alertMsg });
                        await Trade.findByIdAndDelete(trade._id);
                    }
                } catch (err) { console.log("Scanner loop error:", err.message); }
            }
        } catch (error) { console.log("Database Error in Scanner:", error.message); }
    }, 60000);


    // ================= 2. AUTO SIGNAL GENERATOR (Every 15 Mins) - FIXED =================
    setInterval(async () => {
        try {
            const settings = await getSettings();
            if (!settings.autoSignal) return;

            const coinsToScan = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
            const ownerJid = config.OWNER_NUMBER + "@s.whatsapp.net";

            for (let coin of coinsToScan) {
                // ✅ FIX: candles 5 -> 50 (AI ට නිවැරදි analysis කිරීමට)
                const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=15m&limit=50`;
                const res = await axios.get(url);
                const candles = res.data;
                const currentPrice = parseFloat(candles[candles.length - 1][4]).toFixed(2);

                // ✅ FIX: Technical data AI ට දීම (candle text පමණක් නොව)
                const indicators = require('./indicators');
                const smc = require('./smartmoney');

                const rsi = indicators.calculateRSI(candles.slice(-30), 14);
                const ema50 = indicators.calculateEMA(candles, 50);
                const atr = indicators.calculateATR(candles.slice(-20), 14);
                const vwap = indicators.calculateVWAP(candles);
                const volBreak = indicators.checkVolumeBreakout(candles);
                const marketSMC = smc.analyzeSMC(candles);

                // ✅ FIX: Minimum filter - RSI extreme සහ Kill Zone check
                const isGoodKillZone = !marketSMC.killzone.includes("Asian");
                const isRSIExtreme = rsi < 35 || rsi > 65;
                const hasVolume = volBreak.includes("Breakout") && !volBreak.includes("Fakeout");

                // Kill Zone නරකයි හෝ RSI extreme නැත්නම් skip
                if (!isGoodKillZone || (!isRSIExtreme && !hasVolume)) {
                    console.log(`⏭️ Auto Signal Skip: ${coin} - KillZone=${marketSMC.killzone}, RSI=${rsi}`);
                    continue;
                }

                const atrVal = parseFloat(atr) || 0;
                const prompt = `You are an Auto-Signal AI for Crypto Futures. Analyze ${coin} 15m timeframe.

[TECHNICAL DATA]
Current Price: $${currentPrice}
RSI: ${rsi} (Oversold: <30, Overbought: >70)
EMA50: $${ema50}
VWAP: ${vwap}
Volume: ${volBreak}
Kill Zone: ${marketSMC.killzone}
SMC Sweep: ${marketSMC.sweep}
ChoCH: ${marketSMC.choch}
Bullish OB: ${marketSMC.bullishOB}
Bearish OB: ${marketSMC.bearishOB}

RULES:
- If confidence below 75%, reply EXACTLY: NO_TRADE
- Only signal if RSI is extreme (<35 or >65) AND Volume confirms
- ATR value: ${atrVal.toFixed(4)} (use for SL/TP calculation)

If confident, output signal EXACTLY like this:
🚨 *AUTO SIGNAL* 🚨
🪙 Coin: ${coin}
🤖 Action: LONG or SHORT
🛡️ Confidence: XX%
🎯 Entry: X
💰 TP: Y  
🛑 SL: Z

[TARGETS|ENTRY:X|TP:Y|SL:Z]`;

                const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
                const aiRes = await axios.post(groqUrl, {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: prompt }]
                }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

                const responseText = aiRes.data.choices[0].message.content;

                if (!responseText.includes("NO_TRADE")) {
                    await conn.sendMessage(ownerJid, { text: responseText + "\n\n> _Track කිරීමට .track reply කරන්න_" });
                }

                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (err) { console.log("Auto Signal Error:", err.message); }
    }, 15 * 60000);
}

module.exports = { startScanner };