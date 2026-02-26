const axios = require('axios');
const config = require('../config');

async function getKlineData(coin, timeframe, limit = 100) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=${limit}`;
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

async function getTopTrendingCoins(limit = 20) {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
        let coins = res.data.filter(c => 
            c.symbol.endsWith('USDT') && 
            !c.symbol.includes('UP') && 
            !c.symbol.includes('DOWN') &&
            parseFloat(c.lastPrice) > 0.1 
        );
        coins.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return coins.slice(0, limit).map(c => c.symbol);
    } catch (e) {
        console.log("Top Coins Error: ", e.message);
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOGEUSDT'];
    }
}

// ✅ NEW FEATURE: Orderbook Heatmap / Liquidity Walls
async function getLiquidityWalls(coin) {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/depth?symbol=${coin}&limit=500`);
        
        let maxBidVol = 0, bestBidPrice = 0, totalBids = 0;
        res.data.bids.forEach(b => {
            let vol = parseFloat(b[0]) * parseFloat(b[1]); // Price * Qty = USDT value
            totalBids += vol;
            if (vol > maxBidVol) { maxBidVol = vol; bestBidPrice = parseFloat(b[0]); }
        });

        let maxAskVol = 0, bestAskPrice = 0, totalAsks = 0;
        res.data.asks.forEach(a => {
            let vol = parseFloat(a[0]) * parseFloat(a[1]);
            totalAsks += vol;
            if (vol > maxAskVol) { maxAskVol = vol; bestAskPrice = parseFloat(a[0]); }
        });

        // CVD Status
        let cvdStatus = totalBids > totalAsks ? "Bullish 🟢 (More Bids)" : "Bearish 🔴 (More Asks)";

        return { 
            supportWall: bestBidPrice.toFixed(4), 
            resistWall: bestAskPrice.toFixed(4), 
            supportVol: (maxBidVol / 1000000).toFixed(2) + "M", 
            resistVol: (maxAskVol / 1000000).toFixed(2) + "M",
            cvd: cvdStatus
        };
    } catch (e) {
        return { supportWall: "N/A", resistWall: "N/A", supportVol: "0", resistVol: "0", cvd: "Unknown" };
    }
}

module.exports = { getKlineData, getOrderBook, getFearAndGreed, getLiquidationData, getNewsHeadlines, getTopTrendingCoins, getLiquidityWalls };
