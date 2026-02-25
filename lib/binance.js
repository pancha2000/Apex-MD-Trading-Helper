const axios = require('axios');
const config = require('../config');

// 👈 API Key එකක් නොමැතිව Public Data ගන්න විදියට හැදුවා
async function getKlineData(coin, timeframe, limit = 100) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=${limit}`;
        // මෙතනින් headers කෑල්ල අයින් කළා, එතකොට කිසිම Error එකක් එන්නේ නෑ
        const res = await axios.get(url); 
        return res.data;
    } catch (error) { 
        console.log("Binance Error: ", error.message);
        throw new Error('Binance දත්ත ලබාගැනීමේදී දෝෂයක් මතු විය.'); 
    }
}

async function getOrderBook(coin) {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/depth?symbol=${coin}&limit=100`);
        let totalBids = res.data.bids.reduce((sum, order) => sum + (parseFloat(order[0]) * parseFloat(order[1])), 0);
        let totalAsks = res.data.asks.reduce((sum, order) => sum + (parseFloat(order[0]) * parseFloat(order[1])), 0);
        return { totalBids: totalBids.toFixed(2), totalAsks: totalAsks.toFixed(2) };
    } catch (e) { return { totalBids: "Unknown", totalAsks: "Unknown" }; }
}

async function getFearAndGreed() {
    try {
        const res = await axios.get('https://api.alternative.me/fng/');
        return `${res.data.data[0].value} (${res.data.data[0].value_classification})`;
    } catch (e) { return "Unknown"; }
}

// 👈 Whales ලගේ Liquidation දත්ත ගන්න කොටස
async function getLiquidationData(symbol) {
    try {
        const oiRes = await axios.get(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
        const lsRes = await axios.get(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`);
        let longShortRatio = lsRes.data.length > 0 ? parseFloat(lsRes.data[0].longShortRatio).toFixed(2) : "1.00";
        let sentiment = longShortRatio > 1.5 ? "High Longs 🔴 (Risk Down)" : longShortRatio < 0.7 ? "High Shorts 🟢 (Risk Up)" : "Neutral";
        return { openInterest: oiRes.data.openInterest || "Unknown", longShortRatio, sentiment };
    } catch (e) { return { openInterest: "Error", longShortRatio: "1.00", sentiment: "Unknown" }; }
}

async function getNewsHeadlines() {
    try {
        const res = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');
        return res.data.Data.slice(0, 3).map(n => n.title).join(" | ");
    } catch (e) { return "No recent news"; }
}

// ============================================================
// ✅ NEW: Dynamic Market Scanner (Crypto Bubbles Logic)
// මේ මොහොතේ Market එකේ ඉහළම Volume එකක් තියෙන Top Coins ලබා ගැනීම
// ============================================================
async function getTopTrendingCoins(limit = 20) {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
        
        // USDT pairs පමණක් පෙරීම (Up/Down tokens අයින් කිරීම)
        let coins = res.data.filter(c => 
            c.symbol.endsWith('USDT') && 
            !c.symbol.includes('UP') && 
            !c.symbol.includes('DOWN') &&
            parseFloat(c.lastPrice) > 0.1 // සත ගණන් වල තියෙන Shitcoins අයින් කිරීම
        );

        // Quote Volume (මාකට් එකේ කැරකෙන ඩොලර් ප්‍රමාණය) අනුව පිළිවෙලට සැකසීම
        coins.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

        // ඉහළම ටික ලබා දීම
        return coins.slice(0, limit).map(c => c.symbol);
    } catch (e) {
        console.log("Top Coins Error: ", e.message);
        // Error එකක් ආවොත් මේ Backup List එක පාවිච්චි කරනවා
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOGEUSDT'];
    }
}


module.exports = { getKlineData, getOrderBook, getFearAndGreed, getLiquidationData, getNewsHeadlines, getTopTrendingCoins };
