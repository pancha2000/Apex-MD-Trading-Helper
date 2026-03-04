/**
 * ═══════════════════════════════════════════════════════════════
 *  APEX-MD  ·  backtest.js  ·  v6 Enhanced Backtest Engine
 * ═══════════════════════════════════════════════════════════════
 */
'use strict';

const { cmd }    = require('../lib/commands');
const config     = require('../config');
const binance    = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc        = require('../lib/smartmoney');

const {
    calculateStochRSI, calculateBollingerBands,
    detectMTFOBs, detectBBSqueezeExplosion,
    detectVolatilityExpansion, detectMarketMakerTrap,
    calculateSupertrend,
} = require('../lib/indicators');

// ─── Core scoring (mirrors live analyzer, lightweight) ──────────
function backtestScore(candles, i) {
    const slice = candles.slice(Math.max(0, i - 100), i);
    if (slice.length < 50) return { longScore: 0, shortScore: 0, atr: 0, adx: { value: 0 } };
    const cp    = parseFloat(slice[slice.length - 1][4]);
    const ema200 = parseFloat(indicators.calculateEMA(candles.slice(Math.max(0, i - 200), i), 200));
    const ema50  = parseFloat(indicators.calculateEMA(slice, 50));
    const rsi    = indicators.calculateRSI(slice.slice(-50), 14);
    const atr    = parseFloat(indicators.calculateATR(slice.slice(-50), 14));
    const adx    = indicators.calculateADX(slice.slice(-50));
    const macd   = indicators.calculateMACD(slice.slice(-50));
    const vwap   = indicators.calculateVWAP(slice);
    const mSMC   = smc.analyzeSMC(slice.slice(-50));
    const volBrk = indicators.checkVolumeBreakout(slice.slice(-50));
    const harm   = indicators.checkHarmonicPattern(slice);
    const stoch  = calculateStochRSI(slice.slice(-60));
    const bb     = calculateBollingerBands(slice.slice(-30));
    const liqS   = smc.checkLiquiditySweep ? smc.checkLiquiditySweep(slice.slice(-15)) : 'None';
    const choch  = smc.checkChoCH ? smc.checkChoCH(slice.slice(-20)) : 'None';
    const mtfOB  = detectMTFOBs(slice.slice(-15));
    let superT   = { isBull: false, isBear: false, justFlipUp: false, justFlipDown: false };
    let bbSqz    = { exploding: false, explosionDir: 'NONE' };
    let volExp   = { justStarted: false };
    let trap     = { bullTrap: false, bearTrap: false };
    try { superT = calculateSupertrend(slice.slice(-60)); } catch(e) {}
    try { bbSqz  = detectBBSqueezeExplosion(slice.slice(-60)); } catch(e) {}
    try { volExp = detectVolatilityExpansion(slice.slice(-70)); } catch(e) {}
    try { trap   = detectMarketMakerTrap(slice.slice(-25)); } catch(e) {}

    let ls = 0, ss = 0;
    if (cp > ema200) ls++; else ss++;
    if (Math.abs(cp - ema50) / ema50 < 0.005) { if (cp > ema200) ls++; else ss++; }
    if (mSMC.bullishOB) ls++; if (mSMC.bearishOB) ss++;
    if (rsi < 45) ls++; if (rsi > 55) ss++;
    if (vwap.includes('🟢')) ls++; if (vwap.includes('🔴')) ss++;
    if (volBrk.includes('Bullish')) ls++; if (volBrk.includes('Bearish')) ss++;
    if (macd.includes('Bullish')) ls++; if (macd.includes('Bearish')) ss++;
    if (mSMC.sweep.includes('Bullish') || mSMC.choch.includes('Bullish')) ls++;
    if (mSMC.sweep.includes('Bearish') || mSMC.choch.includes('Bearish')) ss++;
    if (harm.includes('Bullish')) ls += 2; if (harm.includes('Bearish')) ss += 2;
    if (stoch.isBull) ls++; if (stoch.isBear) ss++;
    if (bb.isBull) ls++; if (bb.isBear) ss++;
    if (liqS.includes('Bullish')) ls += 2; if (liqS.includes('Bearish')) ss += 2;
    if (choch.includes('Bullish')) ls += 2; if (choch.includes('Bearish')) ss += 2;
    if (superT.justFlipUp) ls += 2; else if (superT.isBull) ls++;
    if (superT.justFlipDown) ss += 2; else if (superT.isBear) ss++;
    if (mtfOB.bullish) ls++; if (mtfOB.bearish) ss++;
    // v6
    if (bbSqz.exploding && bbSqz.explosionDir === 'BULL') ls += 3;
    if (bbSqz.exploding && bbSqz.explosionDir === 'BEAR') ss += 3;
    if (volExp.justStarted) { ls += 2; ss += 2; }
    if (trap.bearTrap) ls += 3; if (trap.bullTrap) ss += 3;

    return { longScore: ls, shortScore: ss, atr, adx, currentPrice: cp };
}

// ─── Simulate one trade with partial TPs ──────────────────────
function simTrade(candles, idx, entry, sl, tp1, tp2, tp3, isLong) {
    const slD = Math.abs(entry - sl);
    if (slD === 0) return { result: 'SKIP', pnlR: 0 };
    let tp1Hit = false, tp2Hit = false, pnlR = 0;
    for (let j = idx; j < candles.length; j++) {
        const hi = parseFloat(candles[j][2]), lo = parseFloat(candles[j][3]);
        if (isLong) {
            if (lo <= sl)    { pnlR += (tp1Hit ? 0.67 : 1.0) * -1; return { result: 'LOSS', pnlR: pnlR + (tp1Hit ? 0.33*1.5:0) + (tp2Hit ? 0.33*3:0) }; }
            if (!tp1Hit && hi >= tp1)  { tp1Hit = true;  pnlR += 0.33 * 1.5; }
            if (tp1Hit && !tp2Hit && hi >= tp2) { tp2Hit = true; pnlR += 0.33 * 3; }
            if (tp2Hit && hi >= tp3)   { pnlR += 0.34 * 5; return { result: 'WIN', pnlR }; }
        } else {
            if (hi >= sl)    { pnlR += (tp1Hit ? 0.67 : 1.0) * -1; return { result: 'LOSS', pnlR: pnlR + (tp1Hit ? 0.33*1.5:0) + (tp2Hit ? 0.33*3:0) }; }
            if (!tp1Hit && lo <= tp1)  { tp1Hit = true;  pnlR += 0.33 * 1.5; }
            if (tp1Hit && !tp2Hit && lo <= tp2) { tp2Hit = true; pnlR += 0.33 * 3; }
            if (tp2Hit && lo <= tp3)   { pnlR += 0.34 * 5; return { result: 'WIN', pnlR }; }
        }
    }
    const lastP = parseFloat(candles[candles.length - 1][4]);
    const openR = isLong ? (lastP - entry) / slD : (entry - lastP) / slD;
    return { result: 'OPEN', pnlR: pnlR + openR * (tp2Hit ? 0.34 : tp1Hit ? 0.67 : 1.0) };
}

// ─── Full backtest run ────────────────────────────────────────
function runBacktest(candles, minScore = 8) {
    let trades = [], equity = 0, maxEq = 0, maxDD = 0;
    let wins = 0, losses = 0, longT = 0, shortT = 0;
    let i = 200;
    while (i < candles.length - 25) {
        const { longScore, shortScore, atr, adx, currentPrice } = backtestScore(candles, i);
        if (atr === 0) { i++; continue; }
        const ok = (adx.value || 0) > 20;
        const isLong  = ok && longScore  >= minScore;
        const isShort = ok && shortScore >= minScore && !isLong;
        if (!isLong && !isShort) { i++; continue; }
        const entry = currentPrice;
        const sl  = isLong ? entry - atr*2   : entry + atr*2;
        const tp1 = isLong ? entry + atr*1.5 : entry - atr*1.5;
        const tp2 = isLong ? entry + atr*3   : entry - atr*3;
        const tp3 = isLong ? entry + atr*5   : entry - atr*5;
        const score = isLong ? longScore : shortScore;
        const { result, pnlR } = simTrade(candles, i, entry, sl, tp1, tp2, tp3, isLong);
        trades.push({ dir: isLong ? 'L' : 'S', entry, result, pnlR, score, idx: i });
        equity += pnlR;
        if (equity > maxEq) maxEq = equity;
        const dd = maxEq - equity;
        if (dd > maxDD) maxDD = dd;
        if (result === 'WIN')  wins++;
        if (result === 'LOSS') losses++;
        if (isLong) longT++; else shortT++;
        i += 20;
    }
    const total = wins + losses;
    const winRate = total > 0 ? (wins/total*100).toFixed(1) : '0.0';
    const gW = trades.filter(t=>t.pnlR>0).reduce((s,t)=>s+t.pnlR,0);
    const gL = Math.abs(trades.filter(t=>t.pnlR<0).reduce((s,t)=>s+t.pnlR,0));
    const pf = gL > 0 ? (gW/gL).toFixed(2) : '∞';
    let conL = 0, maxCL = 0;
    trades.sort((a,b)=>a.idx-b.idx).forEach(t => { if(t.result==='LOSS'){conL++;if(conL>maxCL)maxCL=conL;}else conL=0; });
    const sortedByPnl = [...trades].sort((a,b)=>b.pnlR-a.pnlR);
    return { trades, wins, losses, longT, shortT, total, winRate, pf, gW: gW.toFixed(2), gL: gL.toFixed(2), maxDD: maxDD.toFixed(2), netR: equity.toFixed(2), maxCL, best: sortedByPnl[0], worst: sortedByPnl[sortedByPnl.length-1] };
}

// ═══════════════════════════════════════════════════════════════
// CMD 1: .backtest — Single coin deep backtest
// ═══════════════════════════════════════════════════════════════
cmd({
    pattern: 'backtest', alias: ['bt','test'],
    desc: 'Deep backtest — TP1/TP2/TP3 partial simulation',
    category: 'crypto', react: '⏪', filename: __filename,
}, async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ Coin ලබා දෙන්න!\n*උදා:* ${config.PREFIX}backtest BTC 15m`);
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        const tf = (args[1]||'15m').toLowerCase();
        await m.react('⏳');
        await reply(`⏳ *${coin} Backtest* ආරම්භ වෙමින්...\n1000 candles | TP1+TP2+TP3 | v6 scoring`);

        let candles;
        try { candles = await binance.getKlineData(coin, tf, 1000); }
        catch(e) { return await reply(`❌ ${coin} data error: ${e.message}`); }
        if (!candles || candles.length < 500) return await reply('❌ Insufficient data (need 500+).');

        const r = runBacktest(candles);
        const emoji = parseFloat(r.winRate) >= 60 ? '🏆' : parseFloat(r.winRate) >= 50 ? '✅' : '⚠️';
        const grade = parseFloat(r.pf) >= 2.0 ? 'Excellent 🏆' : parseFloat(r.pf) >= 1.5 ? 'Good ✅' : parseFloat(r.pf) >= 1.0 ? 'Marginal ⚠️' : 'Poor ❌';
        const rec = parseFloat(r.pf) >= 1.5 ? `✅ Trade this coin! Use .future ${coin.replace('USDT','')} ${tf}` : parseFloat(r.pf) >= 1.0 ? `⚠️ Marginal. Use strict filters (score ≥ 12)` : `❌ Avoid ${coin.replace('USDT','')} on ${tf}. Try .scanbacktest`;

        await reply(`╔════════════════════════════╗\n║ 📊 *DEEP BACKTEST RESULTS* ║\n╚════════════════════════════╝\n\n🪙 *${coin.replace('USDT','')}* | ⏱️ ${tf} | 📊 ${candles.length} candles\n\n━━━━━━━━━━━━━━━━━━\n*🎯 v6 Strategy*\n━━━━━━━━━━━━━━━━━━\n▫️ Score ≥ 8/70 + ADX > 20\n▫️ TP1=1.5× | TP2=3× | TP3=5× ATR (partial close)\n▫️ SL = 2× ATR\n▫️ Includes BB Explosion, Trend Start, MM Trap\n\n━━━━━━━━━━━━━━━━━━\n*📈 Performance*\n━━━━━━━━━━━━━━━━━━\n${emoji} *Win Rate: ${r.winRate}%* (${r.wins}W/${r.losses}L)\n📊 Signals: ${r.total} (Long: ${r.longT} | Short: ${r.shortT})\n💰 *Net: ${parseFloat(r.netR)>0?'+':''}${r.netR}R* (1R = your risk per trade)\n📈 Profit Factor: *${r.pf}* → Grade: *${grade}*\n💸 Gross Win: +${r.gW}R | Gross Loss: -${r.gL}R\n📉 Max Drawdown: ${r.maxDD}R\n⚠️ Max Consecutive Losses: ${r.maxCL}\n${r.best  ? `\n🥇 Best Trade: +${r.best.pnlR.toFixed(2)}R (${r.best.dir==='L'?'LONG':'SHORT'} @ $${r.best.entry.toFixed(4)})` : ''}\n${r.worst ? `💀 Worst Trade: ${r.worst.pnlR.toFixed(2)}R` : ''}\n\n━━━━━━━━━━━━━━━━━━\n*📋 Verdict*\n━━━━━━━━━━━━━━━━━━\n${rec}\n\n💡 *.scanbacktest ${tf}* — all coins compare`);
        await m.react('✅');
    } catch(e) { await reply('❌ Error: ' + e.message); }
});

// ═══════════════════════════════════════════════════════════════
// CMD 2: .scanbacktest — Multi-coin backtest, find best performers
// ═══════════════════════════════════════════════════════════════
cmd({
    pattern: 'scanbacktest', alias: ['sbt','bestcoins','topcoins'],
    desc: 'Scanner backtest on all top 20 coins — finds best performers',
    category: 'crypto', react: '🔬', filename: __filename,
}, async (conn, mek, m, { reply, args }) => {
    try {
        await m.react('⏳');
        const tf = args[0] && ['5m','15m','1h','4h'].includes(args[0]) ? args[0] : '15m';
        await reply(`🔬 *SCANNER BACKTEST*\n⏱️ ${tf} | Top 20 coins | 500 candles each\n⏳ ~90 seconds...`);

        let coins;
        try { coins = binance.isReady() ? binance.getWatchedCoins() : await binance.getTopTrendingCoins(20); }
        catch(e) { coins = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOTUSDT']; }

        const results = [];
        for (const coin of coins.slice(0, 20)) {
            try {
                await new Promise(r => setTimeout(r, 400));
                const candles = await binance.getKlineData(coin, tf, 500);
                if (!candles || candles.length < 300) continue;
                const r = runBacktest(candles, 8);
                if (r.total < 3) continue;
                results.push({
                    coin: coin.replace('USDT',''),
                    wr: parseFloat(r.winRate),
                    netR: parseFloat(r.netR),
                    pf: parseFloat(r.pf) || 0,
                    total: r.total, wins: r.wins, losses: r.losses,
                    maxDD: parseFloat(r.maxDD),
                });
            } catch(e) {}
        }

        if (!results.length) return await reply('❌ Test failed. Retry later.');

        // Composite score: winRate × profitFactor / (1 + maxDD)
        results.sort((a,b) => {
            const sa = a.wr * a.pf / (1 + a.maxDD);
            const sb = b.wr * b.pf / (1 + b.maxDD);
            return sb - sa;
        });

        const top5  = results.slice(0,5);
        const worst = results.slice(-3).filter(r => r.pf < 1.0);
        const avgWR = (results.reduce((s,r)=>s+r.wr,0)/results.length).toFixed(1);
        const good  = results.filter(r => r.pf >= 1.5).length;

        let msg = `╔══════════════════════════════╗\n║ 🔬 *SCANNER BACKTEST RESULTS* ║\n╚══════════════════════════════╝\n\n⏱️ *${tf}* | 📊 ${results.length} coins tested\n\n━━━━━━━━━━━━━━━━━━\n🏆 *BEST COINS TO TRADE*\n━━━━━━━━━━━━━━━━━━\n`;
        top5.forEach((r,i) => {
            const m = ['🥇','🥈','🥉','4️⃣','5️⃣'][i];
            const q = r.wr>=60&&r.pf>=1.8 ? '🔥🔥' : r.wr>=55 ? '🔥' : '✅';
            msg += `${m} *#${r.coin}* ${q}\n`;
            msg += `   📈 Win: *${r.wr}%* (${r.wins}W/${r.losses}L/${r.total})\n`;
            msg += `   💰 Net: ${r.netR>0?'+':''}${r.netR.toFixed(1)}R | PF: ${r.pf.toFixed(2)} | DD: ${r.maxDD.toFixed(1)}R\n`;
            msg += `   🤖 *.future ${r.coin} ${tf}*\n\n`;
        });

        if (worst.length) {
            msg += `━━━━━━━━━━━━━━━━━━\n❌ *AVOID (Strategy not working)*\n━━━━━━━━━━━━━━━━━━\n`;
            worst.forEach(r => msg += `• *#${r.coin}* WR:${r.wr}% PF:${r.pf.toFixed(2)} ← Skip\n`);
            msg += '\n';
        }
        msg += `━━━━━━━━━━━━━━━━━━\n📊 *Market Summary: ${tf}*\n━━━━━━━━━━━━━━━━━━\n`;
        msg += `📈 Avg Win Rate: ${avgWR}% | ✅ Good coins: ${good}/${results.length}\n\n`;
        msg += `💡 *.backtest ${top5[0]?.coin||'BTC'} ${tf}* — detailed analysis\n`;
        msg += `💡 *.future ${top5[0]?.coin||'BTC'} ${tf}* — live signal\n`;
        msg += `⚠️ _Past results ≠ future. Use as guidance only._`;

        await reply(msg.trim());
        await m.react('✅');
    } catch(e) { await reply('❌ Error: ' + e.message); }
});
