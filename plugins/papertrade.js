/**
 * ================================================================
 * PAPER TRADE COMMAND (.paper / .pt)
 * ================================================================
 * Analysis reply + .paper → Virtual Binance-style position opens
 * Uses margin setting → calculates leverage, qty, marginUsed
 * .myptrades → Shows all open paper positions with live P&L
 * ================================================================
 */
const { cmd } = require('../lib/commands');
const config  = require('../config');
const db      = require('../lib/database');
const axios   = require('axios');

// ─── Helper: Get live price from Binance ─────────────────────────
async function getLivePrice(coin) {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${coin}`, { timeout: 5000 });
        return parseFloat(res.data.price);
    } catch { return null; }
}

// ─── Helper: Parse analysis message ──────────────────────────────
function parseAnalysisMsg(text) {
    // Coin
    const coinMatch = text.match(/([A-Z]{2,10})\s*\/\s*USDT/)
        || text.match(/🪙\s*([A-Z]{2,10})/)
        || text.match(/\b([A-Z]{2,10})USDT\b/);
    if (!coinMatch) return null;
    const coin = (coinMatch[1]).replace('USDT','') + 'USDT';

    // Direction — Smart Entry line එකෙන් විතරක් detect කරනවා (reasons ලිස්ටුවේ "Short OB" වැනි වචන ignore)
    const smartEntryMatch = text.match(/Smart Entry[^\n]*?(LONG|SHORT)/i)
        || text.match(/\*?(LONG|SHORT)\*?\s*$|direction[":\s]*(LONG|SHORT)/im);
    let direction = 'LONG';
    if (smartEntryMatch) {
        direction = smartEntryMatch[1].toUpperCase();
    } else {
        // Fallback: look for 🔴 SHORT or 🟢 LONG as standalone (not part of reasons)
        const shortMatch = text.match(/🔴\s*\*?SHORT\*?|\bSHORT\b(?!.*OB|.*Zone|.*term)/);
        direction = shortMatch ? 'SHORT' : 'LONG';
    }

    // Entry
    const entryMatch = text.match(/Entry[:\s]*\$?([\d,.]+)/i)
        || text.match(/\[TARGETS\|ENTRY:([\d.]+)/i);
    if (!entryMatch) return null;
    const entry = parseFloat(entryMatch[1].replace(/,/g,''));

    // SL
    const slMatch = text.match(/SL[^:]*:\s*\$?([\d,.]+)/i)
        || text.match(/\|SL:([\d.]+)/i);
    if (!slMatch) return null;
    const sl = parseFloat(slMatch[1].replace(/,/g,''));

    // TP1
    const tp1Match = text.match(/TP1[^$]*\$([\d,.]+)/i);
    const tp1 = tp1Match ? parseFloat(tp1Match[1].replace(/,/g,'')) : null;

    // TP2 (main TP) - with fallback
    const tp2Match = text.match(/TP2[^$]*\$([\d,.]+)/i);
    let finalTp = tp2Match ? parseFloat(tp2Match[1].replace(/,/g,'')) : null;
    if (!finalTp) {
        const tgMatch = text.match(/\|TP:([\d.]+)/i);
        if (!tgMatch) return null;
        finalTp = parseFloat(tgMatch[1]);  // ✅ FIXED: var scope bug → let
    }

    // TP3
    const tp3Match = text.match(/TP3[^$]*\$([\d,.]+)/i);
    const tp3 = tp3Match ? parseFloat(tp3Match[1].replace(/,/g,'')) : null;

    // Leverage (from analysis)
    const levMatch = text.match(/Leverage[:\s]*([\d]+)x/i);
    const analysisLev = levMatch ? parseInt(levMatch[1]) : null;

    // Score
    const scoreMatch = text.match(/Score[:\s]*([\d]+)\s*\//i);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;

    // Timeframe
    const tfMatch = text.match(/\.(?:future|spot|chart)\s+\w+\s+([\d]+[mhd])/i)
        || text.match(/\b(15m|1h|4h|1d|5m|1w)\b/i);
    const timeframe = tfMatch ? tfMatch[1] : '15m';

    return { coin, direction, entry, sl, tp1, tp: finalTp, tp3, analysisLev, score, timeframe };  // tp=finalTp
}

// ─── Calculate position sizing (Binance Risk-Based — safe capped version) ─────
function calcPosition(margin, entry, sl, direction, analysisLev, freeBalance = null) {
    const available = freeBalance !== null ? freeBalance : margin;
    const slDist    = Math.abs(entry - sl);
    const slDistPct = slDist / entry;

    // 2% risk on TOTAL capital (risk amount stays fixed)
    const riskAmt   = margin * 0.02;
    let quantity    = slDist > 0 ? riskAmt / slDist : 0;

    const rawLev    = slDistPct > 0 ? (riskAmt / slDistPct) / (margin * 0.10) : 10;
    const leverage  = analysisLev || Math.min(Math.ceil(rawLev), 100);
    let marginUsed  = quantity > 0 ? (quantity * entry) / leverage : 0;

    // ✅ CRITICAL: Cap marginUsed to 20% of available balance (safety rule)
    const maxMargin = available * 0.20;
    if (marginUsed > maxMargin && maxMargin > 0) {
        const scaleFactor = maxMargin / marginUsed;
        quantity   *= scaleFactor;
        marginUsed  = maxMargin;
    }

    // ✅ Minimum viable trade check
    const minMargin = 0.50; // $0.50 minimum
    if (marginUsed < minMargin) {
        return { riskAmt: 0, quantity: 0, leverage, marginUsed: 0, slDist, tooSmall: true };
    }

    return { riskAmt, quantity, leverage, marginUsed, slDist, tooSmall: false };
}

// ═══════════════════════════════════════════════════════════════
// CMD 1: .paper  — Open virtual paper trade from analysis reply
// ═══════════════════════════════════════════════════════════════
cmd({
    pattern: 'paper',
    alias: ['pt', 'papertrade'],
    desc: 'Analysis reply + .paper → Virtual Binance-style trade open',
    category: 'crypto',
    react: '🤖',
    filename: __filename
}, async (conn, mek, m, { reply }) => {
    try {
        if (!m.quoted) return await reply('❌ .future / .spot Analysis reply කරලා .paper යවන්න.');

        const text = m.quoted.conversation
            || m.quoted.extendedTextMessage?.text
            || m.quoted.text || m.quoted.body || '';
        if (!text) return await reply('❌ Quoted message read කරගන්න බැරිය.');

        const parsed = parseAnalysisMsg(text);
        if (!parsed) return await reply('❌ Analysis message parse කරගන්න බැරිය.\n(Entry/SL/Coin detect නොවිණ)');

        const { coin, direction, entry, sl, tp1, tp, tp3, analysisLev, score, timeframe } = parsed;

        // Stablecoin guard
        const STABLES = ['USDCUSDT','BUSDUSDT','DAIUSDT','TUSDUSDT','USDPUSDT','FRAXUSDT'];
        if (STABLES.includes(coin)) {
            return await reply(`❌ *${coin.replace('USDT','')} Stablecoin!*\nStablecoins paper trade කරන්න බෑ.`);
        }

        if (!tp) return await reply('❌ TP price detect නොවිණ. .future/.spot analysis message reply කරන්න.');

        // Margin check
        const userMargin = await db.getMargin(m.sender);
        if (!userMargin || userMargin <= 0) {
            return await reply(`❌ Capital set කර නැහැ!\n*.margin <amount>* දාලා capital set කරන්න.\nඋදා: .margin 1000`);
        }

        // Check if already have active paper trade for this coin
        const existing = await db.Trade.findOne({
            userJid: m.sender, coin, isPaper: true, status: { $in: ['active', 'pending'] }
        });
        if (existing) {
            return await reply(`⚠️ *${coin} Paper Trade දැනටමත් Open!*\n\nEntry: $${existing.entry} | ${existing.direction}\n\n*.myptrades* ලෙස current positions බලන්න.`);
        }

        // Limit: max 5 open paper trades
        const openCount = await db.Trade.countDocuments({
            userJid: m.sender, isPaper: true, status: { $in: ['active', 'pending'] }
        });
        if (openCount >= 5) {
            return await reply('⚠️ Maximum 5 paper trades open කරන්න පුළුවන්.\n.myptrades ලෙස close/view කරන්න.');
        }

        // ✅ Calculate free (available) balance = total - locked in open trades
        const user = await db.getUser(m.sender);
        const openTrades = await db.Trade.find({ userJid: m.sender, isPaper: true, status: { $in: ['active','pending'] } });
        const lockedMargin = openTrades.reduce((s, t) => s + (t.marginUsed || 0), 0);
        const freeBalance = Math.max(0, (user.paperBalance || userMargin) - lockedMargin);

        if (freeBalance < 1.0) {
            return await reply(
                `❌ *Insufficient Balance!*\n\n` +
                `💰 Total: $${(user.paperBalance || userMargin).toFixed(2)}\n` +
                `🔒 Locked: $${lockedMargin.toFixed(2)} (${openCount} trades)\n` +
                `💵 Free: $${freeBalance.toFixed(2)}\n\n` +
                `⚠️ Free balance ඉතා අඩුයි. Open trades close කරලා retry කරන්න.`
            );
        }

        const { riskAmt, quantity, leverage, marginUsed, tooSmall } = calcPosition(
            userMargin, entry, sl, direction, analysisLev, freeBalance
        );

        if (tooSmall) {
            return await reply(
                `❌ *Position Too Small!*\n\n` +
                `SL distance ඉතා කුඩාය ($${Math.abs(entry-sl).toFixed(6)}).\n` +
                `Minimum $0.50 margin deploy කරන්නට SL distance ප්‍රමාණවත් නැහැ.\n\n` +
                `💡 Wider SL zone ඇති setup එකක් trade කරන්න.`
            );
        }

        // Get live price
        const livePrice = await getLivePrice(coin);
        const priceStatus = livePrice
            ? (Math.abs(livePrice - entry) / entry < 0.005
                ? '✅ Market Price (Entry zone තුළ)'
                : `⚠️ Live: $${livePrice.toFixed(4)} (Entry zone ලඟා වෙනකම් pending)`)
            : '⚡ Active';

        const dirEmoji = direction === 'LONG' ? '🟢' : '🔴';
        const slPct = (Math.abs(entry - sl) / entry * 100).toFixed(2);
        const tpPct = (Math.abs(tp - entry) / entry * 100).toFixed(2);
        const rrr = (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2);

        // Determine if limit order (price not at entry) or market order
        const isAtEntry = livePrice && Math.abs(livePrice - entry) / entry < 0.005;
        const tradeStatus = isAtEntry ? 'active' : 'pending';
        const orderType = isAtEntry ? 'MARKET' : 'LIMIT';

        // Save trade
        await db.saveTrade({
            userJid: m.sender,
            coin, type: 'future', direction,
            entry, tp, tp1: tp1 || tp, tp2: tp, sl,
            rrr: `1:${rrr}`,
            status: tradeStatus,
            orderType,
            fillPrice: tradeStatus === 'active' ? entry : 0,
            isPaper: true,
            leverage, quantity, marginUsed,
            score, timeframe
        });

        const qtyStr = quantity < 1 ? quantity.toFixed(4) : quantity.toFixed(2);
        const coinBase = coin.replace('USDT','');

        await reply(`
🤖 *PAPER TRADE OPENED!*
━━━━━━━━━━━━━━━━━━━━━━

🪙 *${coinBase}/USDT* ${dirEmoji} *${direction}*
📊 Score: ${score} | ⏱️ ${timeframe}

*Position Details:*
📍 Entry:     $${entry}
🎯 TP1:       $${tp1 ? tp1.toFixed(4) : 'N/A'} (+${(tp1 ? Math.abs(tp1-entry)/entry*100 : 0).toFixed(2)}%)
🎯 TP2:       $${tp.toFixed(4)} (+${tpPct}%)
🛡️ SL:        $${sl} (-${slPct}%)
⚖️ RRR:       1:${rrr}

*Virtual Position:*
⚙️ Leverage:  ${leverage}x (Isolated)
📦 Quantity:  ${qtyStr} ${coinBase}
💰 Margin:    $${marginUsed.toFixed(2)} USDT
🛡️ Risk:      $${riskAmt.toFixed(2)} (2% rule)

*Order Type:* ${orderType === 'MARKET' ? '⚡ MARKET ORDER (Active Now)' : '⏳ LIMIT ORDER (Entry zone ලඟා වෙනකම් pending)'}
*Status:* ${tradeStatus === 'active' ? '🟢 ACTIVE' : '🟡 PENDING - Entry Fill වෙනකම් බලන්න'}

📊 Live P&L → *.myptrades*
🗑️ Close → *.closepaper ${coin}*`.trim());

        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});

// ═══════════════════════════════════════════════════════════════
// CMD 2: .myptrades — Show open paper positions with LIVE P&L
// ═══════════════════════════════════════════════════════════════
cmd({
    pattern: 'myptrades',
    alias: ['mypapertrades', 'positions', 'openpositions'],
    desc: 'View open paper trade positions with live P&L',
    category: 'crypto',
    react: '📊',
    filename: __filename
}, async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');

        const trades = await db.Trade.find({
            userJid: m.sender,
            isPaper: true,
            status: { $in: ['active', 'pending'] }
        }).sort({ openTime: -1 });

        const user = await db.getUser(m.sender);

        if (!trades || trades.length === 0) {
            return await reply(`📊 *Open Paper Positions: 0*\n\nVirtual trade open කරන්න:\n*.future BTC 15m* → Analysis ගෙන reply + *.paper*`);
        }

        // Get all live prices in parallel
        const prices = await Promise.all(
            trades.map(t => getLivePrice(t.coin).catch(() => null))
        );

        let totalPnL = 0;
        let totalMargin = 0;
        let msg = `📊 *OPEN PAPER POSITIONS (${trades.length}/5)*\n`;
        msg += `💰 Virtual Balance: $${user.paperBalance.toFixed(2)}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        trades.forEach((t, i) => {
            const livePrice = prices[i];
            const dirEmoji = t.direction === 'LONG' ? '🟢' : '🔴';
            const coinBase = t.coin.replace('USDT','');

            let pnlStr = 'N/A', pnlEmoji = '⚪', unrealizedPnL = 0;
            if (livePrice && t.quantity && t.leverage) {
                const priceDiff = t.direction === 'LONG'
                    ? livePrice - t.entry
                    : t.entry - livePrice;
                unrealizedPnL = priceDiff * t.quantity;
                totalPnL += unrealizedPnL;
                totalMargin += (t.marginUsed || 0);
                const pnlPct = t.marginUsed > 0 ? (unrealizedPnL / t.marginUsed * 100) : 0;
                pnlEmoji = unrealizedPnL >= 0 ? '📈' : '📉';
                pnlStr = `${unrealizedPnL >= 0 ? '+' : ''}$${unrealizedPnL.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`;
            }

            // Distance to TP/SL
            const distToSL = livePrice ? (Math.abs(livePrice - t.sl) / livePrice * 100).toFixed(1) : '?';
            const distToTP = livePrice ? (Math.abs(livePrice - t.tp) / livePrice * 100).toFixed(1) : '?';
            const openTime = new Date(t.openTime);
            const hoursOpen = ((Date.now() - openTime) / 3600000).toFixed(1);

            const orderTag = t.orderType === 'LIMIT' ? '⏳ LIMIT' : '⚡ MARKET';
            const statusTag = t.status === 'pending'
                ? `${orderTag} ORDER - Entry Fill බලාසිටී`
                : t.status === 'active' && t.orderType === 'LIMIT'
                    ? `${orderTag} ORDER - ✅ Filled @ $${t.fillPrice ? t.fillPrice.toFixed(4) : t.entry}`
                    : '🟢 ACTIVE';
            const tp1Status = t.tp1Hit ? '✅' : '⬜';
            const tp2Status = t.tp2Hit ? '✅' : '⬜';
            const dcaStatus = t.dcaLevel > 0 ? ' | ⚠️ DCA Zone Hit' : '';

            msg += `*${i+1}. ${coinBase}/USDT* ${dirEmoji} ${t.direction} (${t.leverage || '?'}x)\n`;
            msg += `📋 ${statusTag}${dcaStatus}\n`;
            msg += `📍 Entry: $${t.entry} → 💹 Live: ${livePrice ? '$' + livePrice.toFixed(4) : 'N/A'}\n`;
            if (t.status === 'pending' && livePrice) {
                const distToEntry = ((Math.abs(livePrice - t.entry) / t.entry) * 100).toFixed(2);
                const direction_to_entry = (t.direction === 'LONG' && livePrice > t.entry) ? '📉 Price drop' : (t.direction === 'SHORT' && livePrice < t.entry) ? '📈 Price rise' : '📍 Near entry';
                msg += `⏳ ${distToEntry}% away (${direction_to_entry} needed)\n`;
            }
            msg += `${pnlEmoji} *PnL: ${t.status === 'pending' ? '⏳ Pending fill...' : pnlStr}*\n`;
            msg += `🎯 TP1 ${tp1Status} $${parseFloat(t.tp1||t.tp).toFixed(4)} | TP2 ${tp2Status} $${parseFloat(t.tp2||t.tp).toFixed(4)}\n`;
            msg += `🎯 TP3: $${parseFloat(t.tp).toFixed(4)} (${distToTP}% away) | 🛡️ SL: $${parseFloat(t.sl).toFixed(4)} (${distToSL}% away)\n`;
            msg += `💰 Margin: $${(t.marginUsed||0).toFixed(2)} | 📦 Qty: ${(t.quantity||0).toFixed(4)} ${coinBase}\n`;
            msg += `⏱️ Open ${hoursOpen}h | 🆔 ${t._id.toString().slice(-6)}\n\n`;
        });

        const totalPnLEmoji = totalPnL >= 0 ? '📈' : '📉';
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `${totalPnLEmoji} *Total Unrealized: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}*\n\n`;
        msg += `🗑️ Close → *.closepaper <COIN>*\n`;
        msg += `📊 Full Stats → *.stats*`;

        await reply(msg);
        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});

// ═══════════════════════════════════════════════════════════════
// CMD 3: .closepaper <COIN> — Manually close paper trade
// ═══════════════════════════════════════════════════════════════
cmd({
    pattern: 'closepaper',
    alias: ['closepapertrade', 'cpt'],
    desc: 'Manually close a paper trade position',
    category: 'crypto',
    react: '🗑️',
    filename: __filename
}, async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply('❌ Coin ලබා දෙන්න!\nඋදා: .closepaper BTC');

        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';

        const trade = await db.Trade.findOne({
            userJid: m.sender,
            coin,
            isPaper: true,
            status: { $in: ['active', 'pending'] }
        });

        if (!trade) return await reply(`❌ ${coin} paper trade open නෑ.\n*.myptrades* ලෙස positions බලන්න.`);

        // Get live price for final P&L
        const livePrice = await getLivePrice(coin);
        let paperProfit = 0, result = 'BREAK-EVEN', pnlPct = 0;

        if (livePrice && trade.quantity) {
            const priceDiff = trade.direction === 'LONG'
                ? livePrice - trade.entry
                : trade.entry - livePrice;
            paperProfit = priceDiff * trade.quantity;
            pnlPct = trade.marginUsed > 0 ? (paperProfit / trade.marginUsed * 100) : 0;
            result = paperProfit > 0 ? 'WIN' : paperProfit < 0 ? 'LOSS' : 'BREAK-EVEN';
        }

        await db.closeTrade(trade._id, result, pnlPct, paperProfit);
        await db.updatePaperBalance(m.sender, paperProfit, result === 'WIN', result === 'BREAK-EVEN');

        const user = await db.getUser(m.sender);
        const resEmoji = result === 'WIN' ? '✅' : result === 'LOSS' ? '❌' : '➖';
        const coinBase = coin.replace('USDT','');

        await reply(`
${resEmoji} *PAPER TRADE CLOSED (Manual)*

🪙 ${coinBase}/USDT | ${trade.direction}
📍 Entry:  $${trade.entry}
💹 Close:  ${livePrice ? '$' + livePrice.toFixed(4) : 'N/A'}

💰 *PnL: ${paperProfit >= 0 ? '+' : ''}$${paperProfit.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)*
📊 Result: *${result}*

💼 New Balance: $${user.paperBalance.toFixed(2)}`.trim());

        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});


// ═══════════════════════════════════════════════════════════════
// CMD 4: .paperhistory — Show closed paper trade history + PnL
// ═══════════════════════════════════════════════════════════════
cmd({
    pattern: 'paperhistory',
    alias: ['ph', 'phistory', 'paperstats'],
    desc: 'Closed paper trade history with PnL',
    category: 'crypto',
    react: '📜',
    filename: __filename
}, async (conn, mek, m, { reply, args }) => {
    try {
        await m.react('⏳');
        const limit = parseInt(args[0]) || 10;

        const trades = await db.Trade.find({
            userJid: m.sender,
            isPaper: true,
            status: 'closed'
        }).sort({ _id: -1 }).limit(Math.min(limit, 20));

        const user = await db.getUser(m.sender);
        const startBal = user.paperStartBalance || user.paperBalance || 0;

        if (!trades || trades.length === 0) {
            return await reply('📜 *Paper Trade History*\n\nClosed trades නෑ.\nFirst trade open කරන්න: *.future BTC 15m* → *.paper*');
        }

        let wins = 0, losses = 0, breakEvens = 0, totalPnL = 0;
        let biggestWin = null, biggestLoss = null;

        let msg = `📜 *PAPER TRADE HISTORY (Last ${trades.length})*\n`;
        msg += `💰 Balance: $${user.paperBalance.toFixed(2)} | Start: $${startBal.toFixed(2)}\n`;
        const netPnL = user.paperBalance - startBal;
        msg += `📈 Net: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        trades.forEach((t, i) => {
            const coinBase = t.coin.replace('USDT', '');
            const dirEmoji = t.direction === 'LONG' ? '🟢' : '🔴';
            const resEmoji = t.result === 'WIN' ? '✅' : t.result === 'LOSS' ? '❌' : '➖';
            const pnl = t.paperProfit || 0;
            const pnlStr = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
            const pnlPct = t.marginUsed > 0 ? (pnl / t.marginUsed * 100) : 0;

            totalPnL += pnl;
            if (t.result === 'WIN') { wins++; if (!biggestWin || pnl > biggestWin.pnl) biggestWin = { coin: coinBase, pnl }; }
            else if (t.result === 'LOSS') { losses++; if (!biggestLoss || pnl < biggestLoss.pnl) biggestLoss = { coin: coinBase, pnl }; }
            else breakEvens++;

            const openDate = new Date(t.openTime || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            msg += `${resEmoji} *${coinBase}* ${dirEmoji} ${t.direction} | ${openDate}\n`;
            msg += `   📍 $${parseFloat(t.entry).toFixed(4)} → `;
            msg += `🎯 $${parseFloat(t.tp || 0).toFixed(4)} | 🛡️ $${parseFloat(t.sl || 0).toFixed(4)}\n`;
            msg += `   💰 PnL: *${pnlStr}* (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%) | ${t.leverage || '?'}x\n\n`;
        });

        const total = wins + losses + breakEvens;
        const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
        const profitFactor = losses > 0 ? (wins * 3 / (losses * 2)).toFixed(2) : '∞';

        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🏆 *Win Rate: ${winRate}%* (${wins}W / ${losses}L / ${breakEvens}BE)\n`;
        msg += `📊 Profit Factor: ${profitFactor}\n`;
        msg += `💰 *Total PnL: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}*\n`;
        if (biggestWin) msg += `🥇 Best: +$${biggestWin.pnl.toFixed(2)} (${biggestWin.coin})\n`;
        if (biggestLoss) msg += `💀 Worst: $${biggestLoss.pnl.toFixed(2)} (${biggestLoss.coin})\n`;
        msg += `\n💡 *.ph 20* — last 20 trades`;

        await reply(msg);
        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});
