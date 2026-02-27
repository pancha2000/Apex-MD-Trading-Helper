const axios = require('axios');
const config = require('../config');

// ✅ BUG FIX 4: Retry mechanism - API fail වෙද්දී 3 වතාවක් try කරනවා
async function withRetry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, delay * (i + 1)));
            } else {
                throw e;
            }
        }
    }
}

async function getKlineData(coin, timeframe, limit = 100) {
    return await withRetry(async () => {
        const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=${limit}`;
        const res = await axios.get(url, { timeout: 10000 });
        return res.data;
    }).catch(error => {
        console.log("Binance Error: ", error.message);
        throw new Error('Binance දත්ත ලබාගැනීමේදී දෝෂයක් මතු විය.');
    });
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

// ✅ NEW: Funding Rate function
async function getFundingRate(coin) {
    try {
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${coin}&limit=1`, { timeout: 5000 });
        if (res.data && res.data.length > 0) {
            const rate = parseFloat(res.data[0].fundingRate) * 100;
            const nextTime = res.data[0].fundingTime;
            const hoursLeft = Math.round((nextTime - Date.now()) / 3600000);
            const emoji = rate > 0.05 ? '🔴' : rate < -0.05 ? '🟢' : '⚪';
            const desc = rate > 0.05 ? 'Longs pay Shorts ⚠️' : rate < -0.05 ? 'Shorts pay Longs ✅' : 'Neutral';
            return `${emoji} ${rate.toFixed(4)}% (${desc}) | Next: ${hoursLeft}h`;
        }
        return 'N/A';
    } catch(e) { return 'N/A'; }
}


// ✅ NEW: Full Market Sentiment Layer (F&G + BTC.D + News + OI)
async function getMarketSentiment(coin = null) {
    const results = await Promise.allSettled([
        // 1. Fear & Greed
        axios.get('https://api.alternative.me/fng/', { timeout: 6000 }),
        // 2. BTC Dominance via CoinGecko
        axios.get('https://api.coingecko.com/api/v3/global', { timeout: 6000 }),
        // 3. Crypto News headlines (last 10)
        axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest&limit=10', { timeout: 6000 }),
        // 4. USDT Dominance proxy (USDT 24hr volume as % proxy)
        axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=USDTBUSD', { timeout: 4000 }).catch(() => null),
    ]);

    // Fear & Greed
    let fngValue = 50, fngLabel = 'Neutral', fngEmoji = '⚪';
    if (results[0].status === 'fulfilled') {
        fngValue = parseInt(results[0].value.data.data[0].value);
        fngLabel = results[0].value.data.data[0].value_classification;
        fngEmoji = fngValue >= 75 ? '🤑' : fngValue >= 55 ? '😊' : fngValue >= 45 ? '😐' : fngValue >= 25 ? '😨' : '😱';
    }

    // BTC Dominance
    let btcDom = 50;
    if (results[1].status === 'fulfilled') {
        btcDom = results[1].value.data.data.market_cap_percentage.btc || 50;
    }

    // News Sentiment Score (coin-specific + general)
    let newsSentimentScore = 0;  // -3 to +3
    let newsHeadlines = [];
    let coinNewsHits = 0;
    if (results[2].status === 'fulfilled') {
        const newsData = results[2].value.data.Data || [];
        newsHeadlines = newsData.slice(0, 5).map(n => n.title);

        const coinBase = coin ? coin.replace('USDT', '').toLowerCase() : '';
        const bullWords = /bull|surge|soar|rally|gain|rise|pump|ath|record|breakout|adoption|buy|moon/i;
        const bearWords = /bear|crash|drop|fall|plunge|dump|warning|fear|ban|hack|sell|scam|fraud|regulation|lawsuit/i;

        newsData.forEach(n => {
            const title = n.title.toLowerCase();
            const isCoinRelated = coinBase && title.includes(coinBase);
            if (isCoinRelated) coinNewsHits++;
            const weight = isCoinRelated ? 2 : 1; // coin-specific news = double weight
            if (bullWords.test(title)) newsSentimentScore += weight;
            if (bearWords.test(title)) newsSentimentScore -= weight;
        });
        newsSentimentScore = Math.max(-5, Math.min(5, newsSentimentScore));
    }

    // Overall Sentiment Decision
    // F&G: >60 = bullish market, <40 = bearish market
    // BTC.D: rising = money into BTC (alts bearish), falling = altseason
    // News: positive = bullish confirmation
    const fngBias = fngValue >= 60 ? 1 : fngValue <= 40 ? -1 : 0;
    const newsBias = newsSentimentScore > 1 ? 1 : newsSentimentScore < -1 ? -1 : 0;
    const btcDomBias = btcDom > 55 ? -0.5 : btcDom < 45 ? 0.5 : 0; // high BTC.D = alts suffer
    const totalBias = fngBias + newsBias + btcDomBias;

    const overallSentiment = totalBias >= 1.5 ? '🟢 BULLISH' : totalBias <= -1.5 ? '🔴 BEARISH' : '⚪ NEUTRAL';
    const tradingBias = totalBias >= 1 ? 'LONG favored' : totalBias <= -1 ? 'SHORT favored' : 'Neutral - trade with caution';

    return {
        fngValue, fngLabel, fngEmoji,
        btcDominance: btcDom.toFixed(1),
        newsSentimentScore,
        coinNewsHits,
        newsHeadlines,
        overallSentiment,
        tradingBias,
        totalBias: totalBias.toFixed(1),
        summary: `${fngEmoji} F&G: ${fngValue} (${fngLabel}) | ₿ BTC.D: ${btcDom.toFixed(1)}% | 📰 News: ${newsSentimentScore > 0 ? '+' : ''}${newsSentimentScore}`
    };
}

module.exports = { getKlineData, getOrderBook, getFearAndGreed, getLiquidationData, getNewsHeadlines, getTopTrendingCoins, getLiquidityWalls, getFundingRate, getMarketSentiment };