const axios = require('axios');
const config = require('../config');

async function getKlineData(coin, timeframe, limit = 100) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=${limit}`;
        const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': config.BINANCE_API } });
        return res.data;
    } catch (error) {
        console.error('Binance API Error:', error.message);
        throw new Error('Binance දත්ත ලබාගැනීමේදී දෝෂයක් මතු විය. Coin නම නිවැරදිදැයි පරීක්ෂා කරන්න.');
    }
}

module.exports = { getKlineData };
