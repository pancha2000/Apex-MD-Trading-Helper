const axios = require('axios');
const config = require('../config');

async function getKlineData(coin, timeframe, limit = 100) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=${limit}`;
        const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': config.BINANCE_API } });
        return res.data;
    } catch (error) { throw new Error('Binance දත්ත ලබාගැනීමේදී දෝෂයක් මතු විය.'); }
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

// 🚀 අලුතින් එකතු කළ Open Interest සහ Funding Rate (Futures Data)
async function getFuturesData(coin) {
    try {
        const fundingRes = await axios.get(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${coin}`);
        const oiRes = await axios.get(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${coin}`);
        return {
            fundingRate: (parseFloat(fundingRes.data.lastFundingRate) * 100).toFixed(4) + '%',
            openInterest: parseFloat(oiRes.data.openInterest).toFixed(2)
        };
    } catch (e) { return { fundingRate: "Unknown", openInterest: "Unknown" }; }
}

// 🚀 අලුතින් එකතු කළ Live Crypto News
async function getNewsHeadlines() {
    try {
        const res = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');
        const news = res.data.Data.slice(0, 3).map(n => n.title).join(" | ");
        return news;
    } catch (e) { return "No recent news"; }
}

module.exports = { getKlineData, getOrderBook, getFearAndGreed, getFuturesData, getNewsHeadlines };
