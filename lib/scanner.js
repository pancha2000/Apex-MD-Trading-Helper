const axios = require('axios');
const { Trade, getSettings } = require('./database');
const config = require('../config');

function startScanner(conn) {
    console.log('🔄 Advanced Background Scanner Started...');
    
    // ================= 1. TP/SL & TRAILING SL SCANNER (Every 1 Min) =================
    setInterval(async () => {
        try {
            const settings = await getSettings(); // Settings චෙක් කිරීම
            const activeTrades = await Trade.find({ status: 'active' });
            if (!activeTrades || activeTrades.length === 0) return;

            for (let trade of activeTrades) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`);
                    const currentPrice = parseFloat(res.data.price);
                    
                    let alertMsg = "";
                    let tradeFinished = false;
                    const isLong = trade.tp > trade.entry;

                    // 🛡️ Trailing SL Logic (Setting එක ON නම් පමණක්)
                    if (settings.trailingSl) {
                        const halfWay = trade.entry + ((trade.tp - trade.entry) / 2);
                        // Long Trade එකක් ලාභ වෙද්දි:
                        if (isLong && currentPrice >= halfWay && trade.sl < trade.entry) {
                            trade.sl = trade.entry; // SL එක Entry එකට ගේනවා
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `🛡️ *TRAILING SL ACTIVATED!* \n\n🪙 *${trade.coin}* (LONG)\nමාකට් එක 50% ක් ලාභයි. ඔබගේ Stop Loss එක Entry ($${trade.entry}) මට්ටමට ගෙන ආවා. දැන් Trade එක Risk-Free! 🎉` });
                        } 
                        // Short Trade එකක් ලාභ වෙද්දි:
                        else if (!isLong && currentPrice <= halfWay && trade.sl > trade.entry) {
                            trade.sl = trade.entry;
                            await trade.save();
                            await conn.sendMessage(trade.userJid, { text: `🛡️ *TRAILING SL ACTIVATED!* \n\n🪙 *${trade.coin}* (SHORT)\nමාකට් එක 50% ක් ලාභයි. ඔබගේ Stop Loss එක Entry ($${trade.entry}) මට්ටමට ගෙන ආවා. දැන් Trade එක Risk-Free! 🎉` });
                        }
                    }

                    // 🎯 TP / SL Check Logic
                    if (isLong) {
                        if (currentPrice >= trade.tp) {
                            alertMsg = `✅ *TAKE PROFIT (TP) HIT!* 🎉\n🪙 *Coin:* ${trade.coin} (LONG)\n💰 *Target:* $${trade.tp}\n💵 *Current Price:* $${currentPrice}`;
                            tradeFinished = true;
                        } else if (currentPrice <= trade.sl) {
                            alertMsg = `⚠️ *STOP LOSS (SL) HIT!* 🛑\n🪙 *Coin:* ${trade.coin} (LONG)\n📉 *SL Level:* $${trade.sl}\n💵 *Current Price:* $${currentPrice}`;
                            tradeFinished = true;
                        }
                    } else { 
                        if (currentPrice <= trade.tp) {
                            alertMsg = `✅ *TAKE PROFIT (TP) HIT!* 🎉\n🪙 *Coin:* ${trade.coin} (SHORT)\n💰 *Target:* $${trade.tp}\n💵 *Current Price:* $${currentPrice}`;
                            tradeFinished = true;
                        } else if (currentPrice >= trade.sl) {
                            alertMsg = `⚠️ *STOP LOSS (SL) HIT!* 🛑\n🪙 *Coin:* ${trade.coin} (SHORT)\n📉 *SL Level:* $${trade.sl}\n💵 *Current Price:* $${currentPrice}`;
                            tradeFinished = true;
                        }
                    }

                    if (tradeFinished && alertMsg !== "") {
                        await conn.sendMessage(trade.userJid, { text: alertMsg });
                        await Trade.findByIdAndDelete(trade._id);
                    }

                } catch (err) { console.log("Scanner loop error:", err.message); }
            }
        } catch (error) { console.log("Database Error in Scanner:", error.message); }
    }, 60000); // හැම විනාඩියකටම


    // ================= 2. AUTO SIGNAL GENERATOR (Every 15 Mins) =================
    setInterval(async () => {
        try {
            const settings = await getSettings();
            if (!settings.autoSignal) return; // Setting එක OFF නම් ලූප් එක නවතින්න

            const coinsToScan = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
            const ownerJid = config.OWNER_NUMBER + "@s.whatsapp.net"; // Owner ගේ නම්බර් එකට යැවීමට

            for (let coin of coinsToScan) {
                const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=15m&limit=20`;
                const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': config.BINANCE_API } });
                const candles = res.data;
                const currentPrice = parseFloat(candles[candles.length - 1][4]).toFixed(2);
                
                const recent = candles.slice(-5).map((c, i) => `C${i + 1}: O=$${parseFloat(c[1]).toFixed(2)}, C=$${parseFloat(c[4]).toFixed(2)}`).join('\n');
                
                const prompt = `You are an Auto-Signal AI. Analyze ${coin} 15m timeframe. Current Price: $${currentPrice}\nRecent Candles:\n${recent}
                
                Identify if there's a highly profitable LONG or SHORT setup. 
                If confidence is below 80%, reply EXACTLY with "NO_TRADE".
                If confidence is 80% or higher, output a short signal EXACTLY like this:
                
                🚨 *AUTO SIGNAL DETECTED* 🚨
                🪙 Coin: ${coin}
                🤖 Action: LONG
                🛡️ Confidence: 85%
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
                    await conn.sendMessage(ownerJid, { text: responseText + "\n\n> _Track කිරීමට මෙම පණිවිඩයට .track යවන්න_" });
                }
                
                await new Promise(r => setTimeout(r, 3000)); // Rate limit වලින් බේරෙන්න පොඩි පමාවක්
            }
        } catch (err) { console.log("Auto Signal Error:", err.message); }
    }, 15 * 60000); // හැම විනාඩි 15කටම
}

module.exports = { startScanner };
