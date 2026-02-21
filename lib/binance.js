const axios = require('axios');
const config = require('../config');

// කැන්ඩල්ස් ලබාගැනීම
async function getKlineData(coin, timeframe, limit = 100) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=${limit}`;
        const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': config.BINANCE_API } });
        return res.data;
    } catch (error) { throw new Error('Binance දත්ත ලබාගැනීමේදී දෝෂයක් මතු විය.'); }
}

// 🐋 Whale Tracking (Order Book Depth) ලබාගැනීම
async function getOrderBook(coin) {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/depth?symbol=${coin}&limit=100`);
        let totalBids = res.data.bids.reduce((sum, order) => sum + (parseFloat(order[0]) * parseFloat(order[1])), 0);
        let totalAsks = res.data.asks.reduce((sum, order) => sum + (parseFloat(order[0]) * parseFloat(order[1])), 0);
        return { totalBids: totalBids.toFixed(2), totalAsks: totalAsks.toFixed(2) };
    } catch (e) { return { totalBids: "Unknown", totalAsks: "Unknown" }; }
}

// 🌍 Fear & Greed Index ලබාගැනීම
async function getFearAndGreed() {
    try {
        const res = await axios.get('https://api.alternative.me/fng/');
        return `${res.data.data[0].value} (${res.data.data[0].value_classification})`;
    } catch (e) { return "Unknown"; }
}

module.exports = { getKlineData, getOrderBook, getFearAndGreed };
