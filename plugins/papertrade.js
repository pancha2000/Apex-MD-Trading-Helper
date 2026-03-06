/**
 * ================================================================
 * PAPER TRADE COMMAND (.paper / .pt)  ·  Institutional-Grade v7
 * ================================================================
 * v7 UPGRADES — Trade Metadata Logging for AI Backtesting:
 *
 *  1. parseAnalysisMsg() now extracts:
 *       • reasons       — the ✔️ factors string (WHAT triggered the trade)
 *       • dailyBias     — Daily Bias label (BULLISH/BEARISH/RANGING)
 *       • regimeLabel   — ADX regime label (TRENDING/RANGING/TRANSITION)
 *       • goldenConf    — Golden Confluence flag (true/false)
 *       tradeCategory already existed — now included in backtesting export
 *
 *  2. db.saveTrade() receives all backtesting fields:
 *       { dailyBias, tradeCategory, reasons, regimeLabel, goldenConf }
 *
 *  3. .closepaper saves close metadata:
 *       { closeType: 'MANUAL', closePrice, closeTime, closeMethod }
 *
 *  4. Scanner auto-closes (TP/SL) already updated in scanner.js
 *     to write closeType/closePrice/closeTime/closeMethod = 'AUTO'
 *
 *  5. Display: dailyBias and Golden Confluence shown in open confirmation.
 *
 * ================================================================
 * All prior logic (order type detection, position sizing, myptrades,
 * paperhistory, resetpaper) preserved exactly.
 * ================================================================
 */
const { cmd } = require('../lib/commands');
const config  = require('../config');
const db      = require('../lib/database');
const axios   = require('axios');

// ─── Helper: Get live price from Binance ─────────────────────────
async function getLivePrice(coin) {
    try {
        const res = await axios.get(
            `https://api.binance.com/api/v3/ticker/price?symbol=${coin}`,
            { timeout: 5000 }
        );
        return parseFloat(res.data.price);
    } catch { return null; }
}

// ─── Helper: Parse analysis message ──────────────────────────────
/**
 * Extracts all trade parameters from a .future / .spot analysis reply.
 *
 * v7: Also extracts backtesting metadata fields:
 *   • reasons       — ✔️ score reasons line
 *   • dailyBias     — Daily Bias string if present in message
 *   • regimeLabel   — ADX regime label if present
 *   • goldenConf    — true if Golden Confluence was noted
 */
function parseAnalysisMsg(text) {
    // ── Coin ──────────────────────────────────────────────────────
    const coinMatch = text.match(/([A-Z]{2,10})\s*\/\s*USDT/)
        || text.match(/🪙\s*([A-Z]{2,10})/)
        || text.match(/\b([A-Z]{2,10})USDT\b/);
    if (!coinMatch) return null;
    const coin = (coinMatch[1]).replace('USDT','') + 'USDT';

    // ── Direction ─────────────────────────────────────────────────
    const smartEntryMatch = text.match(/Smart Entry[^\n]*?(LONG|SHORT)/i)
        || text.match(/\*?(LONG|SHORT)\*?\s*$|direction[":\s]*(LONG|SHORT)/im);
    let direction = 'LONG';
    if (smartEntryMatch) {
        direction = smartEntryMatch[1].toUpperCase();
    } else {
        const shortMatch = text.match(/🔴\s*\*?SHORT\*?|\bSHORT\b(?!.*OB|.*Zone|.*term)/);
        direction = shortMatch ? 'SHORT' : 'LONG';
    }

    // ── Entry ─────────────────────────────────────────────────────
    const entryMatch = text.match(/Entry[:\s]*\$?([\d,.]+)/i)
        || text.match(/\[TARGETS\|ENTRY:([\d.]+)/i);
    if (!entryMatch) return null;
    const entry = parseFloat(entryMatch[1].replace(/,/g,''));

    // ── SL ────────────────────────────────────────────────────────
    const slMatch = text.match(/SL[^:]*:\s*\$?([\d,.]+)/i)
        || text.match(/\|SL:([\d.]+)/i);
    if (!slMatch) return null;
    const sl = parseFloat(slMatch[1].replace(/,/g,''));

    // ── TP1 ──────────────────────────────────────────────────────
    const tp1Match = text.match(/TP1[^$]*\$([\d,.]+)/i);
    const tp1 = tp1Match ? parseFloat(tp1Match[1].replace(/,/g,'')) : null;

    // ── TP2 (main TP) ────────────────────────────────────────────
    const tp2Match = text.match(/TP2[^$]*\$([\d,.]+)/i);
    let finalTp = tp2Match ? parseFloat(tp2Match[1].replace(/,/g,'')) : null;
    if (!finalTp) {
        const tgMatch = text.match(/\|TP:([\d.]+)/i);
        if (!tgMatch) return null;
        finalTp = parseFloat(tgMatch[1]);
    }

    // ── TP3 ──────────────────────────────────────────────────────
    const tp3Match = text.match(/TP3[^$]*\$([\d,.]+)/i);
    const tp3 = tp3Match ? parseFloat(tp3Match[1].replace(/,/g,'')) : null;

    // ── Leverage ─────────────────────────────────────────────────
    const levMatch = text.match(/Leverage[:\s]*([\d]+)x/i);
    const analysisLev = levMatch ? parseInt(levMatch[1]) : null;

    // ── Score ────────────────────────────────────────────────────
    const scoreMatch = text.match(/Score[:\s]*([\d]+)\s*\//i);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;

    // ── Timeframe ────────────────────────────────────────────────
    const tfMatch = text.match(/\.(?:future|spot|chart)\s+\w+\s+([\d]+[mhd])/i)
        || text.match(/\b(15m|1h|4h|1d|5m|1w)\b/i);
    const timeframe = tfMatch ? tfMatch[1] : '15m';

    // ── Trade Category ────────────────────────────────────────────
    const categoryMatch = text.match(/(📅 SWING TRADE[^\n]*|🌅 INTRADAY TRADE[^\n]*|⚡ HIGH-PROB SCALP[^\n]*|📊 STANDARD SETUP[^\n]*)/);
    const tradeCategory = categoryMatch ? categoryMatch[1].trim() : null;

    // ── Order Type ────────────────────────────────────────────────
    const orderLineMatch =
        text.match(/📋\s*\*?Order[^:]*:\*?\s*(LIMIT ORDER|MARKET ORDER)/i) ||
        text.match(/Order[^\n:]*:\s*[^\n]*(LIMIT ORDER|MARKET ORDER)/i);
    let parsedOrderType = null;
    if (orderLineMatch) {
        const raw = orderLineMatch[1].toUpperCase();
        parsedOrderType = raw.includes('LIMIT') ? 'LIMIT' : 'MARKET';
    }

    // ════════════════════════════════════════════════════════════
    // v7 NEW: BACKTESTING METADATA EXTRACTION
    // ════════════════════════════════════════════════════════════

    // ── Reasons (score factors) ───────────────────────────────────
    // The analysis message always contains a "✔️ factor1, factor2..." line.
    // This is the single most important field for backtesting — it tells
    // the AI backtester WHAT signals were active when the trade was taken.
    const reasonsMatch = text.match(/✔️\s*([^\n]+)/);
    const reasons = reasonsMatch ? reasonsMatch[1].trim() : null;

    // ── Daily Bias ────────────────────────────────────────────────
    // Parses the Daily Bias line if future.js / spot.js includes it.
    // Format: "📅 Daily Bias: BULLISH 🟢" or "Daily: BULLISH 🟢"
    // Also catches the simpler dailyTrend format: "Daily: Bullish 🟢"
    const dailyBiasMatch =
        text.match(/Daily\s+Bias[:\s]*(BULLISH|BEARISH|RANGING)[^\n]*/i) ||
        text.match(/📅\s+Daily[:\s]*(Bullish|Bearish|Ranging|BULLISH|BEARISH|RANGING)[^\n]*/i) ||
        text.match(/Daily[:\s]*(Bullish|Bearish)[^\n]*/i);
    const dailyBias = dailyBiasMatch
        ? dailyBiasMatch[1].toUpperCase()
        : null;  // null if not present in message (will be stored as null)

    // ── Regime Label ─────────────────────────────────────────────
    // Parses "Regime: TRENDING (ADX 28.3)" or similar.
    const regimeMatch = text.match(/Regime[:\s]*(TRENDING|RANGING|TRANSITION)[^\n]*/i);
    const regimeLabel = regimeMatch ? regimeMatch[1].toUpperCase() : null;

    // ── Golden Confluence Flag ────────────────────────────────────
    // True if the message contains the Golden Confluence bonus marker.
    const goldenConf = /GOLDEN CONFLUENCE/i.test(text);

    return {
        coin, direction, entry, sl,
        tp1, tp: finalTp, tp3,
        analysisLev, score, timeframe,
        tradeCategory,
        parsedOrderType,
        // v7 backtesting fields
        reasons,
        dailyBias,
        regimeLabel,
        goldenConf,
    };
}

// ─── Calculate position sizing ────────────────────────────────────
function calcPosition(margin, entry, sl, direction, analysisLev, freeBalance = null) {
    const available = freeBalance !== null ? freeBalance : margin;
    const slDist    = Math.abs(entry - sl);
    const slDistPct = slDist / entry;

    const riskAmt   = margin * 0.02;
    let quantity    = slDist > 0 ? riskAmt / slDist : 0;

    const rawLev    = slDistPct > 0 ? (riskAmt / slDistPct) / (margin * 0.10) : 10;
    const leverage  = analysisLev || Math.min(Math.ceil(rawLev), 100);
    let marginUsed  = quantity > 0 ? (quantity * entry) / leverage : 0;

    const maxMargin = available * 0.20;
    if (marginUsed > maxMargin && maxMargin > 0) {
        const scaleFactor = maxMargin / marginUsed;
        quantity   *= scaleFactor;
        marginUsed  = maxMargin;
    }

    const minMargin = 0.50;
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

        const {
            coin, direction, entry, sl, tp1, tp, tp3,
            analysisLev, score, timeframe,
            tradeCategory, parsedOrderType,
            // v7 backtesting fields
            reasons, dailyBias, regimeLabel, goldenConf,
        } = parsed;

        const STABLES = ['USDCUSDT','BUSDUSDT','DAIUSDT','TUSDUSDT','USDPUSDT','FRAXUSDT'];
        if (STABLES.includes(coin)) {
            return await reply(`❌ *${coin.replace('USDT','')} Stablecoin!*\nStablecoins paper trade කරන්න බෑ.`);
        }

        if (!tp) return await reply('❌ TP price detect නොවිණ. .future/.spot analysis message reply කරන්න.');

        const userMargin = await db.getMargin(m.sender);
        if (!userMargin || userMargin <= 0) {
            return await reply(`❌ Capital set කර නැහැ!\n*.margin <amount>* දාලා capital set කරන්න.\nඋදා: .margin 1000`);
        }

        const existing = await db.Trade.findOne({
            userJid: m.sender, coin, isPaper: true, status: { $in: ['active', 'pending'] }
        });
        if (existing) {
            return await reply(
                `⚠️ *${coin} Paper Trade දැනටමත් Open!*\n\n` +
                `Entry: $${existing.entry} | ${existing.direction} | ` +
                `${existing.status === 'pending' ? '⏳ Pending Fill' : '🟢 Active'}\n\n` +
                `*.myptrades* ලෙස current positions බලන්න.`
            );
        }

        const openCount = await db.Trade.countDocuments({
            userJid: m.sender, isPaper: true, status: { $in: ['active', 'pending'] }
        });
        if (openCount >= 5) {
            return await reply('⚠️ Maximum 5 paper trades open කරන්න පුළුවන්.\n.myptrades ලෙස close/view කරන්න.');
        }

        const user = await db.getUser(m.sender);
        const openTrades = await db.Trade.find({
            userJid: m.sender, isPaper: true, status: { $in: ['active','pending'] }
        });
        const lockedMargin = openTrades.reduce((s, t) => s + (t.marginUsed || 0), 0);
        const freeBalance  = Math.max(0, (user.paperBalance || userMargin) - lockedMargin);

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

        const livePrice = await getLivePrice(coin);

        // ── Order Type & Status Determination ────────────────────
        let orderType, tradeStatus;
        if (parsedOrderType) {
            orderType   = parsedOrderType;
            tradeStatus = orderType === 'MARKET' ? 'active' : 'pending';
        } else if (livePrice) {
            const priceDiffPct = Math.abs(livePrice - entry) / entry * 100;
            orderType   = priceDiffPct <= 0.3 ? 'MARKET' : 'LIMIT';
            tradeStatus = orderType === 'MARKET' ? 'active' : 'pending';
        } else {
            orderType   = 'MARKET';
            tradeStatus = 'active';
        }

        const fillPrice = tradeStatus === 'active' ? (livePrice || entry) : 0;

        // ════════════════════════════════════════════════════════════
        // v7: SAVE TRADE WITH FULL BACKTESTING METADATA
        // ─────────────────────────────────────────────────────────
        // These fields are stored in the MongoDB document and will be
        // consumed by the upcoming AI Backtesting module to answer:
        //   • "Which daily biases produce the most wins?"
        //   • "Does Golden Confluence improve win rate?"
        //   • "Which reasons (score factors) correlate with profit?"
        //   • "Does market regime (trending/ranging) affect results?"
        // ════════════════════════════════════════════════════════════
        await db.saveTrade({
            userJid: m.sender,
            coin, type: 'future', direction,
            entry, tp: tp3 || tp, tp1: tp1 || tp, tp2: tp, sl,
            rrr: `1:${(Math.abs((tp3 || tp) - entry) / Math.abs(entry - sl)).toFixed(2)}`,
            status:    tradeStatus,
            orderType: orderType,
            fillPrice: fillPrice,
            isPaper: true,
            leverage, quantity, marginUsed,
            score, timeframe,
            // ── v7 Backtesting fields ──────────────────────────────
            tradeCategory:  tradeCategory  || null,  // '📅 SWING TRADE...' / '⚡ HIGH-PROB SCALP' etc.
            reasons:        reasons        || null,  // 'MTF Bull, Bull OB, ChoCH, ⭐ GOLDEN CONFLUENCE...'
            dailyBias:      dailyBias      || null,  // 'BULLISH' / 'BEARISH' / 'RANGING' / null
            regimeLabel:    regimeLabel    || null,  // 'TRENDING' / 'RANGING' / 'TRANSITION' / null
            goldenConf:     goldenConf     || false, // true = Golden Confluence bonus was active
            openMethod:     'PAPER',                 // PAPER = manual paper trade via .paper command
        });

        // ── Build Display Strings ─────────────────────────────────
        const coinBase  = coin.replace('USDT','');
        const dirEmoji  = direction === 'LONG' ? '🟢' : '🔴';
        const qtyStr    = quantity < 1 ? quantity.toFixed(4) : quantity.toFixed(2);
        const slPct     = (Math.abs(entry - sl) / entry * 100).toFixed(2);
        const tpPct     = (Math.abs(tp - entry) / entry * 100).toFixed(2);
        const rrr       = (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2);
        const tp1Pct    = tp1 ? (Math.abs(tp1 - entry) / entry * 100).toFixed(2) : '0.00';

        const orderTypeDisplay = orderType === 'MARKET'
            ? '⚡ MARKET ORDER (Active Now)'
            : '⏳ LIMIT ORDER (Pending Fill)';
        const statusDisplay = tradeStatus === 'active'
            ? '🟢 ACTIVE'
            : '🟡 PENDING — Entry ලඟා වෙනකම් trade tracker wait කරයි';

        let livePriceNote = '';
        if (livePrice) {
            const distPct = (Math.abs(livePrice - entry) / entry * 100).toFixed(2);
            if (tradeStatus === 'pending') {
                const needsDir = direction === 'LONG'
                    ? (livePrice > entry ? '📉 Price drop needed' : '📍 Near entry zone')
                    : (livePrice < entry ? '📈 Price rise needed' : '📍 Near entry zone');
                livePriceNote = `\n💹 Live:       $${livePrice.toFixed(4)} (${distPct}% away — ${needsDir})`;
            } else {
                livePriceNote = `\n💹 Live:       $${livePrice.toFixed(4)} ✅`;
            }
        }

        const categoryNote = tradeCategory
            ? `\n📋 Type:       ${tradeCategory}`
            : '';

        // ── v7: Daily Bias & Golden Confluence display ────────────
        const biasNote = dailyBias
            ? `\n📅 Daily Bias: ${dailyBias} ${dailyBias === 'BULLISH' ? '🟢' : dailyBias === 'BEARISH' ? '🔴' : '⚪'}`
            : '';
        const regimeNote = regimeLabel
            ? `\n📊 Regime:     ${regimeLabel}`
            : '';
        const goldenNote = goldenConf
            ? `\n⭐ *GOLDEN CONFLUENCE* — Institutional-grade setup!`
            : '';

        await reply(`
🤖 *PAPER TRADE OPENED!*
━━━━━━━━━━━━━━━━━━━━━━

🪙 *${coinBase}/USDT* ${dirEmoji} *${direction}*
📊 Score: ${score}/90 | ⏱️ ${timeframe}${categoryNote}${biasNote}${regimeNote}${goldenNote}

*Position Details:*
📍 Entry:     $${entry}${livePriceNote}
🎯 TP1:       $${tp1 ? tp1.toFixed(4) : 'N/A'} (+${tp1Pct}%)
🎯 TP2:       $${tp.toFixed(4)} (+${tpPct}%)
${tp3 ? `🎯 TP3:       $${tp3.toFixed(4)} (+${(Math.abs(tp3 - entry) / entry * 100).toFixed(2)}%)\n` : ''}🛡️ SL:        $${sl} (-${slPct}%)
⚖️ RRR:       1:${rrr}

*Virtual Position:*
⚙️ Leverage:  ${leverage}x (Isolated)
📦 Quantity:  ${qtyStr} ${coinBase}
💰 Margin:    $${marginUsed.toFixed(2)} USDT
🛡️ Risk:      $${riskAmt.toFixed(2)} (2% rule)

*Order Type:* ${orderTypeDisplay}
*Status:*     ${statusDisplay}

${tradeStatus === 'pending'
    ? '⏳ _Trade Tracker will auto-activate when price reaches entry zone._'
    : '✅ _Position is live. Trade Tracker is monitoring TP/SL._'}

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
            return await reply(
                `📊 *Open Paper Positions: 0*\n\n` +
                `Virtual trade open කරන්න:\n*.future BTC 15m* → Analysis ගෙන reply + *.paper*`
            );
        }

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
            const dirEmoji  = t.direction === 'LONG' ? '🟢' : '🔴';
            const coinBase  = t.coin.replace('USDT','');

            let pnlStr = 'N/A', pnlEmoji = '⚪', unrealizedPnL = 0;
            if (livePrice && t.quantity && t.leverage && t.status === 'active') {
                const priceDiff = t.direction === 'LONG'
                    ? livePrice - t.entry
                    : t.entry - livePrice;
                unrealizedPnL = priceDiff * t.quantity;
                totalPnL    += unrealizedPnL;
                totalMargin += (t.marginUsed || 0);
                const pnlPct = t.marginUsed > 0 ? (unrealizedPnL / t.marginUsed * 100) : 0;
                pnlEmoji = unrealizedPnL >= 0 ? '📈' : '📉';
                pnlStr   = `${unrealizedPnL >= 0 ? '+' : ''}$${unrealizedPnL.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`;
            }

            const distToSL = livePrice ? (Math.abs(livePrice - t.sl) / livePrice * 100).toFixed(1) : '?';
            const openTime  = new Date(t.openTime);
            const hoursOpen = ((Date.now() - openTime) / 3600000).toFixed(1);

            const orderTag  = t.orderType === 'LIMIT' ? '⏳ LIMIT' : '⚡ MARKET';
            const statusTag = t.status === 'pending'
                ? `${orderTag} ORDER — ⏳ Waiting for Entry Fill`
                : t.orderType === 'LIMIT'
                    ? `${orderTag} ORDER — ✅ Filled @ $${t.fillPrice ? t.fillPrice.toFixed(4) : t.entry}`
                    : `⚡ MARKET ORDER — 🟢 ACTIVE`;

            const tp1Status = t.tp1Hit ? '✅' : '⬜';
            const tp2Status = t.tp2Hit ? '✅' : '⬜';
            const dcaStatus = t.dcaLevel > 0 ? ' | ⚠️ DCA Zone Hit' : '';

            // v7: Show Daily Bias and Golden Confluence if saved
            const biasTag = t.dailyBias
                ? `\n📅 Bias: ${t.dailyBias} ${t.dailyBias === 'BULLISH' ? '🟢' : t.dailyBias === 'BEARISH' ? '🔴' : '⚪'}` +
                  (t.goldenConf ? ' | ⭐ Golden Conf' : '')
                : '';

            msg += `*${i+1}. ${coinBase}/USDT* ${dirEmoji} ${t.direction} (${t.leverage || '?'}x)\n`;
            msg += `📋 ${statusTag}${dcaStatus}${biasTag}\n`;
            msg += `📍 Entry: $${t.entry} → 💹 Live: ${livePrice ? '$' + livePrice.toFixed(4) : 'N/A'}\n`;

            if (t.status === 'pending' && livePrice) {
                const distToEntry = ((Math.abs(livePrice - t.entry) / t.entry) * 100).toFixed(2);
                const directionNeeded =
                    (t.direction === 'LONG'  && livePrice > t.entry) ? '📉 Waiting for price drop' :
                    (t.direction === 'SHORT' && livePrice < t.entry) ? '📈 Waiting for price rise' :
                    '📍 Near entry zone — may fill soon';
                msg += `⏳ ${distToEntry}% away (${directionNeeded})\n`;
            }

            msg += `${pnlEmoji} *PnL: ${t.status === 'pending' ? '⏳ Pending fill...' : pnlStr}*\n`;
            const tp2Display = t.tp2 && parseFloat(t.tp2) !== parseFloat(t.tp)
                ? parseFloat(t.tp2).toFixed(4)
                : null;
            const tp3Display = parseFloat(t.tp).toFixed(4);
            const distToTP3 = livePrice ? (Math.abs(livePrice - parseFloat(t.tp)) / livePrice * 100).toFixed(1) : '?';

            msg += `🎯 TP1 ${tp1Status} $${parseFloat(t.tp1||t.tp).toFixed(4)} | TP2 ${tp2Status} $${tp2Display || parseFloat(t.tp2||t.tp).toFixed(4)}\n`;
            msg += `🎯 TP3: $${tp3Display} (${distToTP3}% away) | 🛡️ SL: $${parseFloat(t.sl).toFixed(4)} (${distToSL}% away)\n`;
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
//  v7: Saves close metadata for AI Backtesting module
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

        const livePrice = await getLivePrice(coin);
        const closeTime = new Date();

        let paperProfit = 0, result = 'BREAK-EVEN', pnlPct = 0;

        if (trade.status === 'pending') {
            // ── Close a never-filled pending order — no P&L ──────
            // v7: Save cancel metadata for backtesting
            await db.Trade.findByIdAndUpdate(trade._id, {
                status:      'closed',
                result:      'CANCELLED',
                paperProfit: 0,
                // v7 backtesting close metadata
                closeType:   'CANCELLED',
                closePrice:  livePrice || 0,
                closeTime:   closeTime,
                closeMethod: 'MANUAL',
            });
            const coinBase = coin.replace('USDT','');
            return await reply(
                `🗑️ *PAPER ORDER CANCELLED*\n\n` +
                `🪙 ${coinBase}/USDT | ${trade.direction}\n` +
                `📋 Order Type: ⏳ LIMIT (Never filled)\n` +
                `📍 Intended Entry: $${trade.entry}\n\n` +
                `💰 *PnL: $0.00 (Never activated)*\n` +
                `📊 Result: CANCELLED`
            );
        }

        if (livePrice && trade.quantity) {
            const priceDiff = trade.direction === 'LONG'
                ? livePrice - trade.entry
                : trade.entry - livePrice;
            paperProfit = priceDiff * trade.quantity;
            pnlPct = trade.marginUsed > 0 ? (paperProfit / trade.marginUsed * 100) : 0;
            result  = paperProfit > 0 ? 'WIN' : paperProfit < 0 ? 'LOSS' : 'BREAK-EVEN';
        }

        await db.closeTrade(trade._id, result, pnlPct, paperProfit);
        await db.updatePaperBalance(m.sender, paperProfit, result === 'WIN', result === 'BREAK-EVEN');

        // ── v7: Save close metadata for AI Backtesting module ────
        // This is saved AFTER db.closeTrade() to ensure the document
        // exists with the closed status. These fields help the backtester
        // understand HOW and WHEN trades were exited:
        //   closeType   = 'MANUAL' (user closed via .closepaper)
        //   closePrice  = actual price at close time
        //   closeTime   = timestamp of close
        //   closeMethod = 'MANUAL' vs 'AUTO' (scanner trade manager)
        try {
            await db.Trade.findByIdAndUpdate(trade._id, {
                $set: {
                    closeType:   'MANUAL',
                    closePrice:  livePrice || trade.entry,
                    closeTime:   closeTime,
                    closeMethod: 'MANUAL',
                }
            });
        } catch (_metaErr) { /* non-critical — trade is already closed */ }

        const user      = await db.getUser(m.sender);
        const resEmoji  = result === 'WIN' ? '✅' : result === 'LOSS' ? '❌' : '➖';
        const coinBase  = coin.replace('USDT','');
        const orderTag  = trade.orderType === 'LIMIT' ? '⏳ LIMIT (Filled)' : '⚡ MARKET';

        // v7: Include backtesting metadata in close confirmation
        const biasTag    = trade.dailyBias
            ? `\n📅 Daily Bias at Entry: ${trade.dailyBias} ${trade.dailyBias === 'BULLISH' ? '🟢' : trade.dailyBias === 'BEARISH' ? '🔴' : '⚪'}`
            : '';
        const goldenTag  = trade.goldenConf ? `\n⭐ Golden Confluence was active` : '';
        const reasonsTag = trade.reasons
            ? `\n📋 Entry Reasons: _${trade.reasons.length > 80 ? trade.reasons.slice(0, 80) + '...' : trade.reasons}_`
            : '';

        await reply(`
${resEmoji} *PAPER TRADE CLOSED (Manual)*

🪙 ${coinBase}/USDT | ${trade.direction}
📋 Order: ${orderTag}
📍 Entry:  $${trade.entry}
💹 Close:  ${livePrice ? '$' + livePrice.toFixed(4) : 'N/A'}${biasTag}${goldenTag}${reasonsTag}

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
//  v7: Shows Daily Bias and Golden Confluence in history records
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
            return await reply(
                '📜 *Paper Trade History*\n\nClosed trades නෑ.\n' +
                'First trade open කරන්න: *.future BTC 15m* → *.paper*'
            );
        }

        let wins = 0, losses = 0, breakEvens = 0, totalPnL = 0;
        let biggestWin = null, biggestLoss = null;
        let goldenWins = 0, goldenLosses = 0;  // v7: track golden confluence stats
        let biasWins   = { BULLISH: 0, BEARISH: 0, RANGING: 0 };
        let biasLosses = { BULLISH: 0, BEARISH: 0, RANGING: 0 };

        let msg = `📜 *PAPER TRADE HISTORY (Last ${trades.length})*\n`;
        msg += `💰 Balance: $${user.paperBalance.toFixed(2)} | Start: $${startBal.toFixed(2)}\n`;
        const netPnL = user.paperBalance - startBal;
        msg += `📈 Net: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        trades.forEach((t, i) => {
            const coinBase = t.coin.replace('USDT', '');
            const dirEmoji = t.direction === 'LONG' ? '🟢' : '🔴';
            const resEmoji = t.result === 'WIN' ? '✅' : t.result === 'LOSS' ? '❌' : t.result === 'CANCELLED' ? '🗑️' : '➖';
            const pnl      = t.paperProfit || 0;
            const pnlStr   = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
            const pnlPct   = t.marginUsed > 0 ? (pnl / t.marginUsed * 100) : 0;
            const orderTag = t.orderType === 'LIMIT' ? '⏳' : '⚡';
            const goldIcon = t.goldenConf ? ' ⭐' : '';
            const biasIcon = t.dailyBias
                ? (t.dailyBias === 'BULLISH' ? ' 🟢' : t.dailyBias === 'BEARISH' ? ' 🔴' : ' ⚪')
                : '';

            totalPnL += pnl;
            if      (t.result === 'WIN') {
                wins++;
                if (!biggestWin  || pnl > biggestWin.pnl)  biggestWin  = { coin: coinBase, pnl };
                if (t.goldenConf) goldenWins++;
                if (t.dailyBias && biasWins[t.dailyBias] !== undefined) biasWins[t.dailyBias]++;
            }
            else if (t.result === 'LOSS') {
                losses++;
                if (!biggestLoss || pnl < biggestLoss.pnl) biggestLoss = { coin: coinBase, pnl };
                if (t.goldenConf) goldenLosses++;
                if (t.dailyBias && biasLosses[t.dailyBias] !== undefined) biasLosses[t.dailyBias]++;
            }
            else if (t.result !== 'CANCELLED') breakEvens++;

            const openDate = new Date(t.openTime || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            msg += `${resEmoji} *${coinBase}* ${dirEmoji} ${t.direction} ${orderTag}${goldIcon}${biasIcon} | ${openDate}\n`;
            msg += `   📍 $${parseFloat(t.entry).toFixed(4)} → `;
            msg += `🎯 $${parseFloat(t.tp || 0).toFixed(4)} | 🛡️ $${parseFloat(t.sl || 0).toFixed(4)}\n`;
            msg += `   💰 PnL: *${pnlStr}* (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%) | ${t.leverage || '?'}x\n\n`;
        });

        const total      = wins + losses + breakEvens;
        const winRate    = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
        const profitFactor = losses > 0 ? (wins * 3 / (losses * 2)).toFixed(2) : '∞';

        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🏆 *Win Rate: ${winRate}%* (${wins}W / ${losses}L / ${breakEvens}BE)\n`;
        msg += `📊 Profit Factor: ${profitFactor}\n`;
        msg += `💰 *Total PnL: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}*\n`;
        if (biggestWin)  msg += `🥇 Best: +$${biggestWin.pnl.toFixed(2)} (${biggestWin.coin})\n`;
        if (biggestLoss) msg += `💀 Worst: $${biggestLoss.pnl.toFixed(2)} (${biggestLoss.coin})\n`;

        // ── v7: Backtesting insight snippet ──────────────────────
        const goldenTotal = goldenWins + goldenLosses;
        if (goldenTotal >= 2) {
            const goldenRate = ((goldenWins / goldenTotal) * 100).toFixed(0);
            msg += `\n⭐ *Golden Confluence:* ${goldenRate}% win rate (${goldenWins}W/${goldenLosses}L)\n`;
        }
        const biasData = Object.entries(biasWins).map(([b, w]) => ({ b, w, l: biasLosses[b] })).filter(x => (x.w + x.l) >= 2);
        if (biasData.length) {
            msg += `📅 *Bias Win Rates:*\n`;
            biasData.forEach(x => {
                const r = ((x.w / (x.w + x.l)) * 100).toFixed(0);
                const em = x.b === 'BULLISH' ? '🟢' : x.b === 'BEARISH' ? '🔴' : '⚪';
                msg += `   ${em} ${x.b}: ${r}% (${x.w}W/${x.l}L)\n`;
            });
        }

        msg += `\n💡 *.ph 20* — last 20 trades`;

        await reply(msg);
        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});


// ═══════════════════════════════════════════════════════════════
// CMD 5: .resetpaper [amount] — Paper account reset
// ═══════════════════════════════════════════════════════════════
cmd({
    pattern: 'resetpaper',
    alias: ['paperreset', 'resetpt', 'newpaper'],
    desc: 'Paper trading account සම්පූර්ණයෙන් reset කරන්න',
    category: 'crypto',
    react: '🔄',
    filename: __filename
}, async (conn, mek, m, { reply, args }) => {
    try {
        let resetAmount = 0;
        if (args[0] && !isNaN(parseFloat(args[0]))) {
            resetAmount = parseFloat(args[0]);
        } else {
            resetAmount = await db.getMargin(m.sender) || 100;
        }

        if (resetAmount < 1) {
            return await reply(
                `❌ *Invalid Amount!*\n\n` +
                `Usage: *.resetpaper 500* (amount ලබා දෙන්න)\n` +
                `    හෝ: *.resetpaper* (margin amount use කරනවා)\n\n` +
                `Min: $1`
            );
        }

        const openTrades = await db.Trade.find({
            userJid: m.sender,
            isPaper: true,
            status: { $in: ['active', 'pending'] }
        });

        let closedCount = 0;
        for (const trade of openTrades) {
            try {
                const livePrice = await getLivePrice(trade.coin).catch(() => null);
                let paperProfit = 0;
                if (livePrice && trade.quantity && trade.status === 'active') {
                    const diff = trade.direction === 'LONG'
                        ? livePrice - trade.entry
                        : trade.entry - livePrice;
                    paperProfit = diff * trade.quantity;
                }
                await db.Trade.findByIdAndUpdate(trade._id, {
                    status:      'closed',
                    result:      'MANUAL_RESET',
                    paperProfit: parseFloat(paperProfit.toFixed(2)),
                    closeType:   'RESET',
                    closePrice:  livePrice || trade.entry,
                    closeTime:   new Date(),
                    closeMethod: 'MANUAL',
                });
                closedCount++;
            } catch(e) { /* skip */ }
        }

        await db.setPaperCapital(m.sender, resetAmount);

        if (args[0] && !isNaN(parseFloat(args[0]))) {
            await db.setMargin(m.sender, resetAmount);
        }

        const closedMsg = closedCount > 0
            ? `\n🗑️ Closed ${closedCount} open position(s)`
            : '';

        await reply(`
🔄 *PAPER ACCOUNT RESET!*
━━━━━━━━━━━━━━━━━━━━━━

✅ Account සම්පූර්ණයෙන් reset විය!
${closedMsg}

💰 *New Balance: $${resetAmount.toFixed(2)}*
📊 Start Capital: $${resetAmount.toFixed(2)}
📈 Net P/L: $0.00 (0%)
🎯 Trades: 0 | Win Rate: 0%

━━━━━━━━━━━━━━━━━━━━━━
💡 *Commands:*
   *.paper* — New trade open කරන්න
   *.stats* — Stats බලන්න
   *.resetpaper 500* — $500 ලෙස reset
   *.resetpaper* — Margin amount ලෙස reset`.trim());

        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});
