const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');
const db = require('../lib/database');

const COINS_TO_SCAN = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'LINKUSDT', 'AVAXUSDT', 'DOGEUSDT', 'INJUSDT', 'SUIUSDT'];

// 🧠 Confluence Scoring System (ලකුණු ලබාදීමේ තාක්ෂණය)
async function getTopDownSetups() {
    let foundSetups = [];
    
    for (let coin of COINS_TO_SCAN) {
        try {
            const candles15m = await binance.getKlineData(coin, '15m', 200);
            const candles1h = await binance.getKlineData(coin, '1h', 100);
            const candles4h = await binance.getKlineData(coin, '4h', 100);

            const currentPrice = parseFloat(candles15m[candles15m.length - 1][4]);

            // දර්ශක (Indicators) ගණනය
            const ema50_4h = parseFloat(indicators.calculateEMA(candles4h, 50));
            const trend4H = parseFloat(candles4h[candles4h.length - 1][4]) > ema50_4h ? "UP" : "DOWN";
            const ema50_1h = parseFloat(indicators.calculateEMA(candles1h, 50));
            const trend1H = parseFloat(candles1h[candles1h.length - 1][4]) > ema50_1h ? "UP" : "DOWN";

            const ema200_15m = parseFloat(indicators.calculateEMA(candles15m, 200));
            const ema50_15m = parseFloat(indicators.calculateEMA(candles15m.slice(-50), 50));
            const rsi_15m = parseFloat(indicators.calculateRSI(candles15m.slice(-50)));
            const vwap = indicators.calculateVWAP(candles15m.slice(-50));
            const pattern = indicators.checkCandlePattern(candles15m);
            const marketSMC = smc.analyzeSMC(candles15m.slice(-50));

            // 🎯 ලකුණු පුවරුව (Score Board)
            let longScore = 0, shortScore = 0;
            let longReasons = [], shortReasons = [];

            // 1. MTF Alignment (Points: 1)
            if (trend4H === "UP" && trend1H === "UP") { longScore++; longReasons.push("MTF Bullish"); }
            if (trend4H === "DOWN" && trend1H === "DOWN") { shortScore++; shortReasons.push("MTF Bearish"); }

            // 2. EMA Filter & Pullback (Points: 1)
            let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
            if (currentPrice > ema200_15m && diffFromEma50 < 0.003) { longScore++; longReasons.push("EMA 50 Pullback"); }
            if (currentPrice < ema200_15m && diffFromEma50 < 0.003) { shortScore++; shortReasons.push("EMA 50 Pullback"); }

            // 3. SMC Confirmations (OB & FVG) (Points: 1)
            if (marketSMC.bullishOB !== "None" || marketSMC.bullishFVG !== "None") { longScore++; longReasons.push("Bullish OB/FVG"); }
            if (marketSMC.bearishOB !== "None" || marketSMC.bearishFVG !== "None") { shortScore++; shortReasons.push("Bearish OB/FVG"); }

            // 4. Momentum (RSI) (Points: 1)
            if (rsi_15m < 45) { longScore++; longReasons.push("RSI Oversold"); }
            if (rsi_15m > 55) { shortScore++; shortReasons.push("RSI Overbought"); }

            // 5. Volume (VWAP) (Points: 1)
            if (vwap.includes('🟢')) { longScore++; longReasons.push("Above VWAP"); }
            if (vwap.includes('🔴')) { shortScore++; shortReasons.push("Below VWAP"); }

            // 6. Candlestick Pattern (Points: 1)
            if (pattern.includes('🟢')) { longScore++; longReasons.push(`Pattern: ${pattern}`); }
            if (pattern.includes('🔴')) { shortScore++; shortReasons.push(`Pattern: ${pattern}`); }

            // 🏆 අවසන් තීරණය: ලකුණු 6න් 4ක් හෝ ඊට වඩා වැඩි නම් විතරක් Trade එක දෙනවා (A+ Setup)
            if (longScore >= 4) {
                foundSetups.push({ coin: coin.replace('USDT', ''), type: 'LONG 🟢', score: `${longScore}/6`, price: currentPrice.toFixed(2), entryPoint: ema50_15m.toFixed(2), reasons: longReasons.join(' | ') });
            }
            if (shortScore >= 4) {
                foundSetups.push({ coin: coin.replace('USDT', ''), type: 'SHORT 🔴', score: `${shortScore}/6`, price: currentPrice.toFixed(2), entryPoint: ema50_15m.toFixed(2), reasons: shortReasons.join(' | ') });
            }

        } catch (err) { /* Skip errors */ }
    }
    return foundSetups;
}

// ====================================================
// 1. MANUAL SCAN COMMAND (.scan)
// ====================================================
cmd({
    pattern: "scan",
    alias: ["scanner"],
    desc: "Manual Scoring Scanner",
    category: "crypto",
    react: "🔍",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');
        await reply(`⏳ *Confluence Scoring ස්කෑනරය ක්‍රියාත්මක වේ...*\n(සාධක 6ක් පරීක්ෂා කරමින් පවතී)`);
        
        let setups = await getTopDownSetups();
        
        if (setups.length === 0) {
            return await reply(`╔═══════════════════════════╗\n║ 🔍 *SCORING SCAN RESULTS* ║\n╚═══════════════════════════╝\n\nමෙම මොහොතේ ලකුණු 4/6 ට වඩා ලබාගත් (A+ Quality) Setups කිසිවක් මාකට් එකේ නොමැත. ⚪`);
        }

        let outMsg = `╔═══════════════════════════╗\n║ 🎯 *A+ QUALITY SETUPS* ║\n╚═══════════════════════════╝\n\n`;
        setups.forEach((s, i) => {
            outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score} ⭐)\n   📍 Price: $${s.price}\n   ✔️ Confirmations: ${s.reasons}\n   🤖 AI Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
        });
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ====================================================
// 2. BACKGROUND AUTO SCANNER (Settings හරහා)
// ====================================================
let autoScanStarted = false;

cmd({ on: "body" }, async (conn, mek, m) => {
    if (autoScanStarted) return;
    autoScanStarted = true;

    let botNumber = conn.user.id.split(':')[0] + '@s.whatsapp.net';

    setInterval(async () => {
        try {
            const settings = await db.getSettings();
            if (!settings.autoSignal) return;

            let setups = await getTopDownSetups();
            
            if (setups.length > 0) {
                let outMsg = `🚨 *A+ QUALITY ALERT* 🚨\n\n`;
                setups.forEach((s, i) => {
                    outMsg += `*${i + 1}. #${s.coin}* - ${s.type} (Score: ${s.score})\n   ✔️: ${s.reasons}\n   🤖 Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
                });
                await conn.sendMessage(botNumber, { text: outMsg.trim() });
            }
        } catch (error) { console.log("AutoScanner Background Error:", error.message); }
    }, 15 * 60 * 1000); 
});