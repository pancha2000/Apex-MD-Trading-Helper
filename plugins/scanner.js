const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');
const db = require('../lib/database');

const COINS_TO_SCAN = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'LINKUSDT', 'AVAXUSDT', 'DOGEUSDT', 'INJUSDT', 'SUIUSDT'];

// 🧠 ප්‍රධාන ස්කෑන් කිරීමේ තාක්ෂණය (Core Logic)
async function getTopDownSetups() {
    let foundSetups = [];
    for (let coin of COINS_TO_SCAN) {
        try {
            const candles15m = await binance.getKlineData(coin, '15m', 200);
            const candles1h = await binance.getKlineData(coin, '1h', 100);
            const candles4h = await binance.getKlineData(coin, '4h', 100);

            const currentPrice = parseFloat(candles15m[candles15m.length - 1][4]);

            // 4H & 1H Trend
            const ema50_4h = parseFloat(indicators.calculateEMA(candles4h, 50));
            const trend4H = parseFloat(candles4h[candles4h.length - 1][4]) > ema50_4h ? "UP" : "DOWN";

            const ema50_1h = parseFloat(indicators.calculateEMA(candles1h, 50));
            const trend1H = parseFloat(candles1h[candles1h.length - 1][4]) > ema50_1h ? "UP" : "DOWN";

            // 15m Entry
            const ema200_15m = parseFloat(indicators.calculateEMA(candles15m, 200));
            const ema50_15m = parseFloat(indicators.calculateEMA(candles15m.slice(-50), 50));
            const rsi_15m = parseFloat(indicators.calculateRSI(candles15m.slice(-50)));

            // 🟢 LONG SETUP
            if (trend4H === "UP" && trend1H === "UP" && currentPrice > ema200_15m) {
                let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
                if (diffFromEma50 < 0.003 && rsi_15m < 50) {
                    foundSetups.push({ coin: coin.replace('USDT', ''), type: 'LONG 🟢', price: currentPrice.toFixed(2), entryPoint: ema50_15m.toFixed(2) });
                }
            }

            // 🔴 SHORT SETUP
            if (trend4H === "DOWN" && trend1H === "DOWN" && currentPrice < ema200_15m) {
                let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
                if (diffFromEma50 < 0.003 && rsi_15m > 50) {
                    foundSetups.push({ coin: coin.replace('USDT', ''), type: 'SHORT 🔴', price: currentPrice.toFixed(2), entryPoint: ema50_15m.toFixed(2) });
                }
            }
        } catch (err) { /* Error එකක් ආවොත් මඟහරින්න */ }
    }
    return foundSetups;
}

// ====================================================
// 1. MANUAL SCAN COMMAND (.scan)
// ====================================================
cmd({
    pattern: "scan",
    alias: ["scanner"],
    desc: "Manual Top-Down Scanner",
    category: "crypto",
    react: "🔍",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');
        await reply(`⏳ *Top-Down Multi-Coin ස්කෑනරය ක්‍රියාත්මක වේ...*`);
        
        let setups = await getTopDownSetups();
        
        if (setups.length === 0) {
            return await reply(`╔═══════════════════════════╗\n║ 🔍 *TOP-DOWN SCAN RESULTS* ║\n╚═══════════════════════════╝\n\nමාකට් එකේ දැනට 4H සහ 1H දිශාවන් සමග ගැළපෙන (High Probability) නිවැරදිම Trade Setups කිසිවක් නොමැත. ⚪`);
        }

        let outMsg = `╔═══════════════════════════╗\n║ 🎯 *HIGH PROBABILITY SETUPS* ║\n╚═══════════════════════════╝\n\nස්කෑන් කළ කොයින්ස්: 10\nහමුවූ Setups: ${setups.length} 🔥\n\n`;
        setups.forEach((s, i) => {
            outMsg += `*${i + 1}. #${s.coin}* - ${s.type}\n   📍 Price: $${s.price}\n   🎯 Ideal Entry: $${s.entryPoint}\n   🤖 Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
        });
        
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ====================================================
// 2. BACKGROUND AUTO SCANNER (Settings හරහා පාලනය වේ)
// ====================================================
let autoScanStarted = false;

// බොට්ට ඕනෑම මැසේජ් එකක් ආපු ගමන් මේක Background එකේ රන් වෙන්න පටන් ගන්නවා
cmd({ on: "body" }, async (conn, mek, m) => {
    if (autoScanStarted) return;
    autoScanStarted = true;

    // බොට්ගේම අංකය (Saved Messages වලට Alerts යවන්න)
    let botNumber = conn.user.id.split(':')[0] + '@s.whatsapp.net';

    setInterval(async () => {
        try {
            // Database එකෙන් Settings චෙක් කිරීම
            const settings = await db.getSettings();
            if (!settings.autoSignal) return; // Settings වල Option 1 'OFF' නම් මේක වැඩ කරන්නේ නෑ

            let setups = await getTopDownSetups();
            
            // Trade එකක් හොයාගත්තොත් විතරක් මැසේජ් එකක් යවනවා
            if (setups.length > 0) {
                let outMsg = `🚨 *AUTO SCANNER ALERT* 🚨\n\n`;
                setups.forEach((s, i) => {
                    outMsg += `*${i + 1}. #${s.coin}* - ${s.type}\n   🎯 Entry: $${s.entryPoint}\n   🤖 Check: ${config.PREFIX}future ${s.coin} 15m\n\n`;
                });
                
                // Alert එක කෙලින්ම බොට්ගේ Inbox එකට යවනවා
                await conn.sendMessage(botNumber, { text: outMsg.trim() });
            }
        } catch (error) { 
            console.log("AutoScanner Background Error:", error.message); 
        }
    }, 15 * 60 * 1000); // හැම විනාඩි 15කට සැරයක්ම චෙක් කරනවා
});
