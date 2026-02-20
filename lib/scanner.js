const axios = require('axios');
const { Trade } = require('./database'); // Database එකෙන් Trade Model එක ලබාගැනීම

function startScanner(conn) {
    console.log('🔄 Background Trade Scanner Started...');
    
    // හැම තත්පර 60කට (විනාඩියකට) වරක්ම ධාවනය වන ලූප් එක
    setInterval(async () => {
        try {
            // Database එකෙන් සියලුම Active Trades ලබාගැනීම
            const activeTrades = await Trade.find({ status: 'active' });
            if (!activeTrades || activeTrades.length === 0) return;

            for (let trade of activeTrades) {
                try {
                    // Binance එකෙන් Live Price එක ලබාගැනීම
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.coin}`);
                    const currentPrice = parseFloat(res.data.price);

                    let alertMsg = "";
                    let tradeFinished = false;
                    const isLong = trade.tp > trade.entry; // Buy=Long, Sell=Short

                    // Long Trade එකක් නම් (උදා: Entry 60000, TP 62000)
                    if (isLong) {
                        if (currentPrice >= trade.tp) {
                            alertMsg = `✅ *TAKE PROFIT (TP) HIT!* 🎉\n\n🪙 *Coin:* ${trade.coin} (LONG)\n💰 *Target:* $${trade.tp}\n💵 *Current Price:* $${currentPrice}\n\nඔබගේ Trade එක සාර්ථකයි! ලාභය ලබාගන්න.`;
                            tradeFinished = true;
                        } else if (currentPrice <= trade.sl) {
                            alertMsg = `⚠️ *STOP LOSS (SL) HIT!* 🛑\n\n🪙 *Coin:* ${trade.coin} (LONG)\n📉 *SL Level:* $${trade.sl}\n💵 *Current Price:* $${currentPrice}\n\nTrade එක පාඩුවකින් අවසන් විය.`;
                            tradeFinished = true;
                        }
                    } 
                    // Short Trade එකක් නම් (උදා: Entry 60000, TP 58000)
                    else { 
                        if (currentPrice <= trade.tp) {
                            alertMsg = `✅ *TAKE PROFIT (TP) HIT!* 🎉\n\n🪙 *Coin:* ${trade.coin} (SHORT)\n💰 *Target:* $${trade.tp}\n💵 *Current Price:* $${currentPrice}\n\nඔබගේ Trade එක සාර්ථකයි! ලාභය ලබාගන්න.`;
                            tradeFinished = true;
                        } else if (currentPrice >= trade.sl) {
                            alertMsg = `⚠️ *STOP LOSS (SL) HIT!* 🛑\n\n🪙 *Coin:* ${trade.coin} (SHORT)\n📉 *SL Level:* $${trade.sl}\n💵 *Current Price:* $${currentPrice}\n\nTrade එක පාඩුවකින් අවසන් විය.`;
                            tradeFinished = true;
                        }
                    }

                    // Alert එක යවා Trade එක Database එකෙන් මකා දැමීම
                    if (tradeFinished && alertMsg !== "") {
                        await conn.sendMessage(trade.userJid, { text: alertMsg });
                        await Trade.findByIdAndDelete(trade._id); // Delete trade from tracking
                    }

                } catch (err) {
                    console.log("Scanner loop error for coin:", trade.coin, err.message);
                }
            }
        } catch (error) {
            console.log("Scanner Database Error:", error.message);
        }
    }, 60000); // විනාඩියකට සැරයක් පරීක්ෂා කරයි (60000ms)
}

module.exports = { startScanner };
