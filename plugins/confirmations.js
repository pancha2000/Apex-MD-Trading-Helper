/**
 * ================================================================
 * APEX-MD CONFIRMATIONS ENGINE
 * 8 Advanced Entry Confirmation Factors
 * ================================================================
 * 1.  USDT Dominance (Stablecoin flow)
 * 2.  Open Interest Change % (OI momentum)
 * 3.  CVD - Cumulative Volume Delta (Buy vs Sell pressure)
 * 4.  HTF Weekly/Monthly Key Levels (macro S/R)
 * 5.  BTC Correlation (altcoin alignment)
 * 6.  Put/Call Ratio (options sentiment - Deribit)
 * 7.  On-chain Netflow proxy (exchange inflow/outflow estimate)
 * 8.  Social Volume proxy (LunarCrush - optional, needs API key)
 * ================================================================
 */

const axios = require('axios');

// ─── SAFE FETCH HELPER ───────────────────────────────────────────
async function safeFetch(url, opts = {}) {
    try {
        const res = await axios.get(url, { timeout: 6000, ...opts });
        return res.data;
    } catch (e) {
        return null;
    }
}

// ================================================================
// FACTOR 1: USDT Dominance
// Logic: USDT.D falling = money flowing INTO crypto (bullish)
//        USDT.D rising = money flowing OUT of crypto (bearish)
// Proxy: CoinGecko global - stablecoin market cap % 
// ================================================================
async function getUSDTDominance() {
    try {
        const data = await safeFetch('https://api.coingecko.com/api/v3/global');
        if (!data) return { value: null, signal: 'NEUTRAL', display: 'N/A', detail: 'API unavailable' };

        const usdtPct = data.data.market_cap_percentage.usdt || 0;
        const usdcPct = data.data.market_cap_percentage.usdc || 0;
        const totalStablePct = usdtPct + usdcPct;

        // Historical baseline ~7-9% is neutral. >9.5% = risk-off, <6.5% = risk-on
        let signal = 'NEUTRAL';
        let emoji = '⚪';
        let detail = '';

        if (totalStablePct > 9.5) {
            signal = 'BEARISH';
            emoji = '🔴';
            detail = 'High stablecoin % = investors holding cash (risk-off)';
        } else if (totalStablePct < 6.5) {
            signal = 'BULLISH';
            emoji = '🟢';
            detail = 'Low stablecoin % = capital deployed into crypto (risk-on)';
        } else {
            detail = 'Stablecoin % neutral range';
        }

        return {
            value: totalStablePct.toFixed(2),
            usdtPct: usdtPct.toFixed(2),
            signal,
            emoji,
            detail,
            display: `${emoji} ${totalStablePct.toFixed(1)}% (USDT: ${usdtPct.toFixed(1)}%)`
        };
    } catch (e) {
        return { value: null, signal: 'NEUTRAL', emoji: '⚪', display: 'N/A', detail: 'Error' };
    }
}

// ================================================================
// FACTOR 2: Open Interest Change %
// Logic: OI ↑ + Price ↑ = Strong bullish (new longs entering)
//        OI ↑ + Price ↓ = Strong bearish (new shorts entering)
//        OI ↓ + Price ↑ = Weak rally (short covering only)
//        OI ↓ + Price ↓ = Liquidation/deleveraging
// ================================================================
async function getOIChange(coin) {
    try {
        // Current OI
        const currentData = await safeFetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${coin}`);
        if (!currentData) return { signal: 'NEUTRAL', display: 'N/A (Spot only)', detail: 'Not a futures pair' };

        // OI history (5 periods back = ~5 mins)
        const histData = await safeFetch(
            `https://fapi.binance.com/futures/data/openInterestHist?symbol=${coin}&period=5m&limit=6`
        );

        if (!histData || histData.length < 2) {
            return { signal: 'NEUTRAL', display: `OI: ${parseFloat(currentData.openInterest).toFixed(0)}`, detail: 'History unavailable' };
        }

        const currentOI = parseFloat(currentData.openInterest);
        const prevOI = parseFloat(histData[0].sumOpenInterest);
        const oiChange = ((currentOI - prevOI) / prevOI) * 100;

        // Price change for divergence check (1h)
        const priceData = await safeFetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${coin}`);
        const priceChange = priceData ? parseFloat(priceData.priceChangePercent) : 0;

        let signal = 'NEUTRAL';
        let emoji = '⚪';
        let detail = '';

        const oiRising = oiChange > 0.3;
        const oiFalling = oiChange < -0.3;
        const priceRising = priceChange > 0;

        if (oiRising && priceRising) {
            signal = 'BULLISH'; emoji = '🟢';
            detail = 'OI↑ + Price↑ = New longs entering (strong bull)';
        } else if (oiRising && !priceRising) {
            signal = 'BEARISH'; emoji = '🔴';
            detail = 'OI↑ + Price↓ = New shorts entering (strong bear)';
        } else if (oiFalling && priceRising) {
            signal = 'WEAK_BULL'; emoji = '🟡';
            detail = 'OI↓ + Price↑ = Short squeeze only (weak rally)';
        } else if (oiFalling && !priceRising) {
            signal = 'DELEVERAGING'; emoji = '🟠';
            detail = 'OI↓ + Price↓ = Liquidations / deleveraging';
        } else {
            detail = 'OI change minimal';
        }

        return {
            currentOI: currentOI.toFixed(0),
            oiChangePct: oiChange.toFixed(2),
            signal, emoji, detail,
            display: `${emoji} OI Change: ${oiChange >= 0 ? '+' : ''}${oiChange.toFixed(2)}%`
        };
    } catch (e) {
        return { signal: 'NEUTRAL', emoji: '⚪', display: 'N/A', detail: 'Error: ' + e.message };
    }
}

// ================================================================
// FACTOR 3: CVD - Cumulative Volume Delta
// Logic: CVD = Σ(Buy Volume) - Σ(Sell Volume)
//        CVD Rising = Buying pressure dominant (bullish)
//        CVD Falling = Selling pressure dominant (bearish)
// Method: Binance aggTrades - taker buy vs sell volume
// ================================================================
async function getCVD(coin) {
    try {
        // Get recent agg trades (last ~200 trades)
        const trades = await safeFetch(
            `https://api.binance.com/api/v3/aggTrades?symbol=${coin}&limit=200`
        );
        if (!trades || trades.length === 0) {
            return { signal: 'NEUTRAL', display: 'N/A', detail: 'No trade data' };
        }

        let buyVol = 0, sellVol = 0;
        for (const t of trades) {
            const vol = parseFloat(t.q); // quantity
            if (t.m === false) { // maker=false means taker buy
                buyVol += vol;
            } else {
                sellVol += vol;
            }
        }

        const totalVol = buyVol + sellVol;
        const cvdRatio = totalVol > 0 ? ((buyVol - sellVol) / totalVol) * 100 : 0;
        const dominance = buyVol > sellVol ? 'BUYERS' : 'SELLERS';

        let signal = 'NEUTRAL';
        let emoji = '⚪';
        let detail = '';

        if (cvdRatio > 10) {
            signal = 'BULLISH'; emoji = '🟢';
            detail = `Strong buy pressure (${buyVol.toFixed(2)} vs ${sellVol.toFixed(2)})`;
        } else if (cvdRatio < -10) {
            signal = 'BEARISH'; emoji = '🔴';
            detail = `Strong sell pressure (${sellVol.toFixed(2)} vs ${buyVol.toFixed(2)})`;
        } else if (cvdRatio > 3) {
            signal = 'MILD_BULL'; emoji = '🟡';
            detail = `Mild buy pressure`;
        } else if (cvdRatio < -3) {
            signal = 'MILD_BEAR'; emoji = '🟡';
            detail = `Mild sell pressure`;
        } else {
            detail = 'Buy/Sell balanced';
        }

        return {
            buyVol: buyVol.toFixed(2),
            sellVol: sellVol.toFixed(2),
            cvdRatio: cvdRatio.toFixed(1),
            dominance, signal, emoji, detail,
            display: `${emoji} CVD: ${dominance} ${cvdRatio >= 0 ? '+' : ''}${cvdRatio.toFixed(1)}%`
        };
    } catch (e) {
        return { signal: 'NEUTRAL', emoji: '⚪', display: 'N/A', detail: 'Error' };
    }
}

// ================================================================
// FACTOR 4: HTF (Higher Timeframe) Key Levels
// Logic: Weekly & Monthly S/R levels near current price = major zone
//        Trading AT a major HTF level = high-probability area
// ================================================================
async function getHTFLevels(coin) {
    try {
        const [weeklyCandles, monthlyCandles] = await Promise.all([
            safeFetch(`https://api.binance.com/api/v3/klines?symbol=${coin}&interval=1w&limit=20`),
            safeFetch(`https://api.binance.com/api/v3/klines?symbol=${coin}&interval=1M&limit=12`)
        ]);

        if (!weeklyCandles || !monthlyCandles) {
            return { signal: 'NEUTRAL', display: 'N/A', detail: 'HTF data unavailable' };
        }

        const currentPrice = parseFloat(weeklyCandles[weeklyCandles.length - 1][4]);

        // Weekly highs and lows (last 20 weeks)
        const weeklyHighs = weeklyCandles.map(c => parseFloat(c[2]));
        const weeklyLows = weeklyCandles.map(c => parseFloat(c[3]));

        // Monthly highs and lows (last 12 months)
        const monthlyHighs = monthlyCandles.map(c => parseFloat(c[2]));
        const monthlyLows = monthlyCandles.map(c => parseFloat(c[3]));

        // Find nearest HTF levels (within 3% of current price)
        const threshold = 0.03;
        const allLevels = [];

        [...weeklyHighs, ...weeklyLows, ...monthlyHighs, ...monthlyLows].forEach(level => {
            const dist = Math.abs(level - currentPrice) / currentPrice;
            if (dist < threshold) {
                allLevels.push({ level, dist, pct: (dist * 100).toFixed(2) });
            }
        });

        // Sort by proximity
        allLevels.sort((a, b) => a.dist - b.dist);

        const weeklyHigh = Math.max(...weeklyHighs.slice(-4)); // last 4 weeks
        const weeklyLow = Math.min(...weeklyLows.slice(-4));
        const monthlyHigh = Math.max(...monthlyHighs.slice(-3));
        const monthlyLow = Math.min(...monthlyLows.slice(-3));

        // Is price near a major HTF level?
        const nearHTFLevel = allLevels.length > 0;
        const nearestLevel = allLevels[0];

        let signal = 'NEUTRAL';
        let emoji = '⚪';
        let detail = '';

        if (nearHTFLevel) {
            const isPriceAbove = currentPrice > nearestLevel.level;
            signal = isPriceAbove ? 'AT_SUPPORT' : 'AT_RESISTANCE';
            emoji = isPriceAbove ? '🟢' : '🔴';
            detail = `Price near HTF level $${nearestLevel.level.toFixed(4)} (${nearestLevel.pct}% away)`;
        } else {
            detail = 'Price in open air - no major HTF level nearby';
        }

        return {
            currentPrice,
            weeklyHigh: weeklyHigh.toFixed(4),
            weeklyLow: weeklyLow.toFixed(4),
            monthlyHigh: monthlyHigh.toFixed(4),
            monthlyLow: monthlyLow.toFixed(4),
            nearLevels: allLevels.slice(0, 3),
            signal, emoji, detail,
            display: `${emoji} HTF: W.High $${weeklyHigh.toFixed(4)} | W.Low $${weeklyLow.toFixed(4)}`,
            displayFull: `📅 Weekly: $${weeklyLow.toFixed(4)} - $${weeklyHigh.toFixed(4)}\n📅 Monthly: $${monthlyLow.toFixed(4)} - $${monthlyHigh.toFixed(4)}${nearHTFLevel ? `\n⚠️ Near HTF Level: $${nearestLevel.level.toFixed(4)}` : ''}`
        };
    } catch (e) {
        return { signal: 'NEUTRAL', emoji: '⚪', display: 'N/A', detail: 'Error' };
    }
}

// ================================================================
// FACTOR 5: BTC Correlation
// Logic: For altcoins, if BTC direction != trade direction = risk
//        BTC pumping + Altcoin SHORT = dangerous
//        BTC dumping + Altcoin LONG = dangerous
// ================================================================
async function getBTCCorrelation(coin, tradeDirection) {
    try {
        // If it IS BTC, skip
        if (coin === 'BTCUSDT') {
            return { signal: 'N/A', display: 'N/A (IS BTC)', detail: 'Trade is BTC itself', isAlts: false };
        }

        const [btcData, coinData] = await Promise.all([
            safeFetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
            safeFetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${coin}`)
        ]);

        if (!btcData || !coinData) {
            return { signal: 'NEUTRAL', display: 'N/A', detail: 'API error' };
        }

        const btcChange = parseFloat(btcData.priceChangePercent);
        const coinChange = parseFloat(coinData.priceChangePercent);
        const btcTrend = btcChange > 0.5 ? 'BULLISH' : btcChange < -0.5 ? 'BEARISH' : 'NEUTRAL';

        // ETH is semi-independent, BTC pairs more correlated
        const isHighCorrelation = !['ETHUSDT', 'SOLUSDT'].includes(coin);

        let signal = 'NEUTRAL';
        let emoji = '⚪';
        let detail = '';

        const tradeIsLong = tradeDirection === 'LONG';

        if (btcTrend === 'BULLISH' && tradeIsLong) {
            signal = 'CONFIRMED'; emoji = '🟢';
            detail = `BTC ${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(2)}% ✅ aligned with LONG`;
        } else if (btcTrend === 'BEARISH' && !tradeIsLong) {
            signal = 'CONFIRMED'; emoji = '🟢';
            detail = `BTC ${btcChange.toFixed(2)}% ✅ aligned with SHORT`;
        } else if (btcTrend === 'BULLISH' && !tradeIsLong) {
            signal = 'CONFLICT'; emoji = '🔴';
            detail = `BTC ${btcChange.toFixed(2)}% ⚠️ conflicts with SHORT`;
        } else if (btcTrend === 'BEARISH' && tradeIsLong) {
            signal = 'CONFLICT'; emoji = '🔴';
            detail = `BTC ${btcChange.toFixed(2)}% ⚠️ conflicts with LONG`;
        } else {
            detail = `BTC neutral (${btcChange.toFixed(2)}%)`;
        }

        // Correlation coefficient (simple direction match)
        const correlated = (btcChange > 0 && coinChange > 0) || (btcChange < 0 && coinChange < 0);
        const corrPct = correlated ? '+' : '-';

        return {
            btcChange: btcChange.toFixed(2),
            coinChange: coinChange.toFixed(2),
            btcTrend,
            correlated,
            signal, emoji, detail,
            display: `${emoji} BTC: ${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(2)}% | ${coin.replace('USDT', '')}: ${coinChange >= 0 ? '+' : ''}${coinChange.toFixed(2)}% (${corrPct}corr)`,
            isAlts: true
        };
    } catch (e) {
        return { signal: 'NEUTRAL', emoji: '⚪', display: 'N/A', detail: 'Error' };
    }
}

// ================================================================
// FACTOR 6: Options Put/Call Ratio (Deribit - BTC/ETH only)
// Logic: PCR > 1.2 = More puts = Bearish sentiment
//        PCR < 0.7 = More calls = Bullish/Greedy
//        PCR 0.7-1.2 = Neutral
// ================================================================
async function getPutCallRatio(coin) {
    try {
        const base = coin.replace('USDT', '');
        // Only BTC and ETH have liquid options markets
        if (!['BTC', 'ETH'].includes(base)) {
            return { signal: 'N/A', display: 'N/A (No options)', detail: 'Options only for BTC/ETH' };
        }

        const data = await safeFetch(
            `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${base}&kind=option`
        );

        if (!data || !data.result) {
            return { signal: 'NEUTRAL', display: 'N/A', detail: 'Deribit API unavailable' };
        }

        let totalCallOI = 0, totalPutOI = 0;
        data.result.forEach(opt => {
            const oi = opt.open_interest || 0;
            if (opt.instrument_name.endsWith('-C')) totalCallOI += oi;
            if (opt.instrument_name.endsWith('-P')) totalPutOI += oi;
        });

        if (totalCallOI === 0) {
            return { signal: 'NEUTRAL', display: 'N/A', detail: 'No options data' };
        }

        const pcr = totalPutOI / totalCallOI;

        let signal = 'NEUTRAL';
        let emoji = '⚪';
        let detail = '';

        if (pcr > 1.3) {
            signal = 'BEARISH'; emoji = '🔴';
            detail = `PCR ${pcr.toFixed(2)} > 1.3 - Heavy put buying (fear/hedging)`;
        } else if (pcr < 0.7) {
            signal = 'BULLISH'; emoji = '🟢';
            detail = `PCR ${pcr.toFixed(2)} < 0.7 - Call heavy (bullish bets)`;
        } else if (pcr < 0.9) {
            signal = 'MILD_BULL'; emoji = '🟡';
            detail = `PCR ${pcr.toFixed(2)} - Slightly call heavy`;
        } else {
            detail = `PCR ${pcr.toFixed(2)} - Balanced`;
        }

        return {
            pcr: pcr.toFixed(3),
            totalCallOI: totalCallOI.toFixed(0),
            totalPutOI: totalPutOI.toFixed(0),
            signal, emoji, detail,
            display: `${emoji} PCR: ${pcr.toFixed(2)} (P:${(totalPutOI/1000).toFixed(0)}K / C:${(totalCallOI/1000).toFixed(0)}K)`
        };
    } catch (e) {
        return { signal: 'NEUTRAL', emoji: '⚪', display: 'N/A', detail: 'Error' };
    }
}

// ================================================================
// FACTOR 7: Exchange Netflow Proxy
// Logic: High sell volume on exchanges = distribution (bearish)
//        Low sell volume, high buy = accumulation (bullish)
// Proxy: Binance 24h trade imbalance (taker buy vs total)
// (Real netflow needs Glassnode API key - this is a free proxy)
// ================================================================
async function getNetflowProxy(coin) {
    try {
        const data = await safeFetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${coin}`);
        if (!data) return { signal: 'NEUTRAL', display: 'N/A', detail: 'API error' };

        const takerBuyVol = parseFloat(data.takerBuyBaseAssetVolume);
        const totalVol = parseFloat(data.volume);

        if (totalVol === 0) return { signal: 'NEUTRAL', display: 'N/A', detail: 'No volume' };

        const buyRatio = (takerBuyVol / totalVol) * 100;
        const sellRatio = 100 - buyRatio;

        let signal = 'NEUTRAL';
        let emoji = '⚪';
        let detail = '';

        if (buyRatio > 56) {
            signal = 'BULLISH'; emoji = '🟢';
            detail = `${buyRatio.toFixed(1)}% taker buys - accumulation pressure`;
        } else if (buyRatio < 44) {
            signal = 'BEARISH'; emoji = '🔴';
            detail = `${sellRatio.toFixed(1)}% taker sells - distribution pressure`;
        } else {
            detail = `Buy/Sell ratio balanced (${buyRatio.toFixed(1)}% buys)`;
        }

        return {
            buyRatio: buyRatio.toFixed(1),
            sellRatio: sellRatio.toFixed(1),
            takerBuyVol: takerBuyVol.toFixed(2),
            signal, emoji, detail,
            display: `${emoji} Netflow Proxy: ${buyRatio.toFixed(1)}% Buy / ${sellRatio.toFixed(1)}% Sell`
        };
    } catch (e) {
        return { signal: 'NEUTRAL', emoji: '⚪', display: 'N/A', detail: 'Error' };
    }
}

// ================================================================
// FACTOR 8: Social Volume (LunarCrush - optional)
// Needs LUNAR_API key in config. Falls back gracefully if missing.
// ================================================================
async function getSocialVolume(coin, lunarApiKey = null) {
    if (!lunarApiKey) {
        return {
            signal: 'N/A', display: 'N/A (No LUNAR_API)',
            detail: 'Add LUNAR_API to config.env to enable social signals'
        };
    }
    try {
        const base = coin.replace('USDT', '').toLowerCase();
        const data = await safeFetch(
            `https://lunarcrush.com/api4/public/coins/${base}/v1`,
            { headers: { Authorization: `Bearer ${lunarApiKey}` } }
        );

        if (!data || !data.data) {
            return { signal: 'NEUTRAL', display: 'N/A', detail: 'LunarCrush unavailable' };
        }

        const d = data.data;
        const galaxyScore = d.galaxy_score || 50; // 0-100
        const altRank = d.alt_rank || 500;        // lower = better
        const socialChange = d.social_volume_24h_change || 0;

        let signal = 'NEUTRAL';
        let emoji = '⚪';
        let detail = '';

        if (galaxyScore > 65 && socialChange > 20) {
            signal = 'BULLISH'; emoji = '🟢';
            detail = `Galaxy ${galaxyScore} | Social volume +${socialChange}% (viral)`;
        } else if (galaxyScore < 35 || socialChange < -30) {
            signal = 'BEARISH'; emoji = '🔴';
            detail = `Galaxy ${galaxyScore} | Social volume ${socialChange}% (fading)`;
        } else {
            detail = `Galaxy ${galaxyScore} | AltRank #${altRank}`;
        }

        return {
            galaxyScore, altRank, socialChange,
            signal, emoji, detail,
            display: `${emoji} Social: Galaxy ${galaxyScore} | AltRank #${altRank} | Δ${socialChange >= 0 ? '+' : ''}${socialChange}%`
        };
    } catch (e) {
        return { signal: 'NEUTRAL', emoji: '⚪', display: 'N/A', detail: 'Error' };
    }
}

// ================================================================
// MASTER FUNCTION: Run all 8 confirmations in parallel
// Returns aggregated score and full display string
// ================================================================
async function runAllConfirmations(coin, direction, lunarApiKey = null) {
    const isLong = direction === 'LONG';

    // Run all in parallel for speed
    const [
        usdtDom, oiChange, cvd, htfLevels,
        btcCorr, pcr, netflow, social
    ] = await Promise.all([
        getUSDTDominance(),
        getOIChange(coin),
        getCVD(coin),
        getHTFLevels(coin),
        getBTCCorrelation(coin, direction),
        getPutCallRatio(coin),
        getNetflowProxy(coin),
        getSocialVolume(coin, lunarApiKey)
    ]);

    // ─── AGGREGATE SCORE ─────────────────────────────────────────
    // Each factor gives: +1 (confirms), 0 (neutral/N/A), -1 (conflicts)
    const scoreMap = {
        'BULLISH': isLong ? 1 : -1,
        'BEARISH': isLong ? -1 : 1,
        'CONFIRMED': 1,
        'CONFLICT': -1,
        'AT_SUPPORT': isLong ? 1 : 0,
        'AT_RESISTANCE': isLong ? 0 : 1,
        'MILD_BULL': isLong ? 0.5 : -0.5,
        'MILD_BEAR': isLong ? -0.5 : 0.5,
        'WEAK_BULL': isLong ? 0.5 : -0.5,
        'DELEVERAGING': isLong ? -0.5 : 0.5,
        'NEUTRAL': 0, 'N/A': 0
    };

    const factors = [usdtDom, oiChange, cvd, htfLevels, btcCorr, pcr, netflow, social];
    let totalScore = 0;
    let scoredCount = 0;

    factors.forEach(f => {
        const s = scoreMap[f.signal] || 0;
        totalScore += s;
        if (f.signal !== 'N/A') scoredCount++;
    });

    // Normalize to percentage
    const maxPossible = scoredCount;
    const normalizedScore = maxPossible > 0 ? ((totalScore / maxPossible) * 100).toFixed(0) : 0;

    // Overall verdict
    let verdict = '⚪ NEUTRAL';
    let verdictDetail = 'Mixed signals - trade with caution';
    let confirmationStrength = 'WEAK';

    if (totalScore >= 3) {
        verdict = '🟢 STRONGLY CONFIRMED';
        verdictDetail = 'Multiple factors align with trade direction';
        confirmationStrength = 'STRONG';
    } else if (totalScore >= 1.5) {
        verdict = '🟡 CONFIRMED';
        verdictDetail = 'Majority of factors support trade';
        confirmationStrength = 'MODERATE';
    } else if (totalScore <= -3) {
        verdict = '🔴 STRONGLY REJECTED';
        verdictDetail = 'Multiple factors conflict - avoid this trade';
        confirmationStrength = 'CONFLICT';
    } else if (totalScore <= -1.5) {
        verdict = '🟠 CAUTION';
        verdictDetail = 'Several factors conflict with trade direction';
        confirmationStrength = 'CAUTION';
    }

    // ─── DISPLAY STRING ──────────────────────────────────────────
    const display = `
*🔬 ADVANCED ENTRY CONFIRMATION (${scoredCount}/8 Factors)*

${usdtDom.emoji} *Stablecoin Flow:* ${usdtDom.display}
${oiChange.emoji} *Open Interest:*   ${oiChange.display}
${cvd.emoji} *CVD:*             ${cvd.display}
${htfLevels.emoji} *HTF Levels:*      ${htfLevels.display}
${btcCorr.emoji} *BTC Corr:*        ${btcCorr.display}
${pcr.emoji} *Put/Call Ratio:*  ${pcr.display}
${netflow.emoji} *Netflow Proxy:*   ${netflow.display}
${social.emoji} *Social Volume:*   ${social.display}

━━━━━━━━━━━━━━━━━━
${verdict}
_Confirmation Score: ${totalScore >= 0 ? '+' : ''}${totalScore.toFixed(1)} / ${maxPossible} (${confirmationStrength})_
${verdictDetail}`;

    return {
        usdtDom, oiChange, cvd, htfLevels,
        btcCorr, pcr, netflow, social,
        totalScore, normalizedScore,
        verdict, verdictDetail, confirmationStrength,
        display
    };
}

module.exports = {
    getUSDTDominance,
    getOIChange,
    getCVD,
    getHTFLevels,
    getBTCCorrelation,
    getPutCallRatio,
    getNetflowProxy,
    getSocialVolume,
    runAllConfirmations
};
