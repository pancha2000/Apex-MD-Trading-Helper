const axios = require('axios');
const { Trade, getSettings, closeTrade } = require('../lib/database');
const config = require('../config');

function startScanner(conn) {
    console.log('🔄 Advanced Background Scanner Started...');

    // ═══════════════════════════════════════════════════════
    // SCANNER 1: TP/SL + PARTIAL TP + TRAILING SL (Every 1 Min)
    // ═══════════════════════════════════════════════════════
    setInterval(async () => {
        try {
            const settings = await getSettings();
            const activeTrades = await Trade.find({ status: 'active' });
            if (!activeTrades || activeTrades.length === 0) return;

            for (let trade of activeTrades) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`);
                    const currentPrice = parseFloat(res.data.price);
                    const isLong = trade.tp > trade.entry;

                    // ─── ✅ Feature 4: PARTIAL TP ALERT ─────────────────
                    if (settings.partialTp && trade.tp1 && !trade.tp1Hit) {
                        const tp1Hit = isLong
                            ? currentPrice >= trade.tp1
                            : currentPrice <= trade.tp1;

                        if (tp1Hit) {
                            trade.tp1Hit = true;
                            await trade.save();

                            const tp1PnlPct = isLong
                                ? ((trade.tp1 - trade.entry) / trade.entry * 100).toFixed(2)
                                : ((trade.entry - trade.tp1) / trade.entry * 100).toFixed(2);

                            await conn.sendMessage(trade.userJid, { text:
`🎯 *TP1 HIT! PARTIAL PROFIT ALERT* 💰

🪙 *${trade.coin}* (${isLong ? 'LONG' : 'SHORT'})
✅ TP1: $${trade.tp1} ළඟා විය!
📈 Profit: +${tp1PnlPct}%

📌 *නිර්දේශිත ක්‍රියාව:*
▪️ Position ලෙ *50% දැන් Close* කරන්න 🔒
▪️ ඉතිරි 50% TP2 ($${trade.tp}) දක්වා hold
▪️ SL Entry ($${trade.entry}) ලෙ move කරන්න (Risk-Free)

_TP2 hit වූ විට නැවත alert ලැබේ._`
                            });
                        }
                    }

                    // ─── TRAILING SL ─────────────────────────────────────
                    if (settings.trailingSl) {
                        const halfWay = trade.entry + ((trade.tp - trade.entry) / 2);
                        if (isLong && currentPrice >= halfWay && trade.sl < trade.entry) {
                            trade.sl = trade.entry;
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text:
`🛡️ *TRAILING SL ACTIVATED!*

🪙 *${trade.coin}* (LONG)
Market 50% profit zone ළඟා විය.
✅ Stop Loss Entry ($${trade.entry}) ලෙ ගෙනාවා.
දැන් Trade Risk-Free! 🎉` });
                        } else if (!isLong && currentPrice <= halfWay && trade.sl > trade.entry) {
                            trade.sl = trade.entry;
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text:
`🛡️ *TRAILING SL ACTIVATED!*

🪙 *${trade.coin}* (SHORT)
Market 50% profit zone ළඟා විය.
✅ Stop Loss Entry ($${trade.entry}) ලෙ ගෙනාවා.
දැන් Trade Risk-Free! 🎉` });
                        }
                    }

                    // ─── TP2 / SL CHECK ──────────────────────────────────
                    let alertMsg = "", tradeFinished = false, result = null, pnlPct = 0;

                    if (isLong) {
                        if (currentPrice >= trade.tp) {
                            pnlPct = ((trade.tp - trade.entry) / trade.entry * 100);
                            alertMsg = `✅ *TAKE PROFIT (TP2) HIT!* 🎉\n\n🪙 *${trade.coin}* (LONG)\n💰 TP2: $${trade.tp}\n📈 Total Profit: +${pnlPct.toFixed(2)}%\n\n_Trade Journal ලෙ WIN ලෙස record විය._`;
                            result = 'WIN'; tradeFinished = true;
                        } else if (currentPrice <= trade.sl) {
                            pnlPct = ((trade.sl - trade.entry) / trade.entry * 100);
                            alertMsg = `⚠️ *STOP LOSS HIT!* 🛑\n\n🪙 *${trade.coin}* (LONG)\n📉 SL: $${trade.sl}\n💸 Loss: ${pnlPct.toFixed(2)}%\n\n_Trade Journal ලෙ LOSS ලෙස record විය._`;
                            result = 'LOSS'; tradeFinished = true;
                        }
                    } else {
                        if (currentPrice <= trade.tp) {
                            pnlPct = ((trade.entry - trade.tp) / trade.entry * 100);
                            alertMsg = `✅ *TAKE PROFIT (TP2) HIT!* 🎉\n\n🪙 *${trade.coin}* (SHORT)\n💰 TP2: $${trade.tp}\n📈 Total Profit: +${pnlPct.toFixed(2)}%\n\n_Trade Journal ලෙ WIN ලෙස record විය._`;
                            result = 'WIN'; tradeFinished = true;
                        } else if (currentPrice >= trade.sl) {
                            pnlPct = ((trade.entry - trade.sl) / trade.entry * 100);
                            alertMsg = `⚠️ *STOP LOSS HIT!* 🛑\n\n🪙 *${trade.coin}* (SHORT)\n📉 SL: $${trade.sl}\n💸 Loss: ${pnlPct.toFixed(2)}%\n\n_Trade Journal ලෙ LOSS ලෙස record විය._`;
                            result = 'LOSS'; tradeFinished = true;
                        }
                    }

                    if (tradeFinished) {
                        await conn.sendMessage(trade.userJid, { text: alertMsg });
                        // ✅ Journal ලෙ record, delete නොකර close කරනවා
                        await closeTrade(trade._id, result, pnlPct);
                    }

                } catch (err) { console.log("Scanner loop error:", err.message); }
            }
        } catch (error) { console.log("DB Scanner Error:", error.message); }
    }, 60000);


    // ═══════════════════════════════════════════════════════
    // SCANNER 2: AUTO SIGNAL GENERATOR (Every 15 Mins)
    // ═══════════════════════════════════════════════════════
    setInterval(async () => {
        try {
            const settings = await getSettings();
            if (!settings.autoSignal) return;

            const coinsToScan = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
            const ownerJid = config.OWNER_NUMBER + "@s.whatsapp.net";

            for (let coin of coinsToScan) {
                const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=15m&limit=50`;
                const res = await axios.get(url);
                const candles = res.data;
                const currentPrice = parseFloat(candles[candles.length - 1][4]).toFixed(2);

                const indicators = require('./indicators');
                const smc = require('./smartmoney');

                const rsi      = indicators.calculateRSI(candles.slice(-30), 14);
                const ema50    = indicators.calculateEMA(candles, 50);
                const atr      = indicators.calculateATR(candles.slice(-20), 14);
                const vwap     = indicators.calculateVWAP(candles);
                const volBreak = indicators.checkVolumeBreakout(candles);
                const marketSMC = smc.analyzeSMC(candles);

                const isGoodKillZone = !marketSMC.killzone.includes("Asian");
                const isRSIExtreme   = rsi < 35 || rsi > 65;
                const hasVolume      = volBreak.includes("Breakout") && !volBreak.includes("Fakeout");

                if (!isGoodKillZone || (!isRSIExtreme && !hasVolume)) continue;

                const atrVal = parseFloat(atr) || 0;
                const prompt = `You are an Auto-Signal AI for Crypto Futures. Analyze ${coin} 15m.

[TECHNICAL DATA]
Current Price: $${currentPrice}
RSI: ${rsi} | EMA50: $${ema50} | VWAP: ${vwap}
Volume: ${volBreak} | Kill Zone: ${marketSMC.killzone}
SMC: Sweep=${marketSMC.sweep} | ChoCH=${marketSMC.choch}
Bull OB: ${marketSMC.bullishOBDisplay} | Bear OB: ${marketSMC.bearishOBDisplay}
ATR: ${atrVal.toFixed(4)}

RULES:
- Confidence below 75%: reply EXACTLY "NO_TRADE"
- Only signal if RSI extreme (<35 or >65) AND volume confirms
- RRR must be at least 1:1.5

If confident:
🚨 *AUTO SIGNAL* 🚨
🪙 Coin: ${coin}
🤖 Action: LONG or SHORT
🛡️ Confidence: XX%
🎯 Entry: X | 💰 TP1: Y1 | TP2: Y2 | 🛑 SL: Z

[TARGETS|ENTRY:X|TP:Y2|SL:Z]`;

                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: prompt }]
                }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

                const responseText = aiRes.data.choices[0].message.content;
                if (!responseText.includes("NO_TRADE")) {
                    await conn.sendMessage(ownerJid, { text: responseText + "\n\n> _Track: .track reply_" });
                }

                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (err) { console.log("Auto Signal Error:", err.message); }
    }, 15 * 60000);
}

module.exports = { startScanner };