const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

// 📌 Default Coins List
let scanList = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOGEUSDT', 'DOTUSDT'];

let scanIntervalId = null; 
let isScanning = false;

// ස්කෑන් කිරීමේ ක්‍රියාවලිය (අලුත් කරන ලදී)
async function performScan(conn, jid, timeframe = '15m', isFirstRun = false) {
    try {
        let alerts = [];
        
        for (let coin of scanList) {
            // දත්ත ලබාගැනීම
            const candles = await binance.getKlineData(coin, timeframe, 50);
            const currentPrice = parseFloat(candles[candles.length - 1][4]);
            
            const rsi = parseFloat(indicators.calculateRSI(candles));
            const pattern = indicators.checkCandlePattern(candles);
            const marketSMC = smc.analyzeSMC(candles);

            let signal = null;

            // 1. Oversold + Bullish Pattern
            if (rsi < 35 && pattern.includes('🟢')) {
                signal = 'LONG 🟢';
            }
            // 2. Overbought + Bearish Pattern
            else if (rsi > 65 && pattern.includes('🔴')) {
                signal = 'SHORT 🔴';
            }
            
            // 3. Golden Pocket (0.618 Fib) අසල නම්
            const fib618 = parseFloat(marketSMC.fib618);
            const diffPercent = Math.abs(currentPrice - fib618) / fib618 * 100;
            if (diffPercent < 0.5 && !signal) { 
                signal = 'WATCH ⚠️ (Near Fib 0.618)'; 
            }

            if (signal) {
                let cleanCoin = coin.replace('USDT', '');
                alerts.push(`🪙 *${cleanCoin}* - ${signal} (RSI: ${rsi})`);
            }
        }

        // අවස්ථා හමුවුණා නම් Group එකට මැසේජ් එක යැවීම
        if (alerts.length > 0) {
            const outMsg = `🚨 *MARKET ALERTS (${timeframe})* 🚨\n\n` + alerts.join('\n');
            await conn.sendMessage(jid, { text: outMsg });
        } 
        // පළමු ස්කෑන් එකේදී මුකුත්ම හමුවුණේ නැත්නම් ඒ බව දැනුම් දීම
        else if (isFirstRun) {
            await conn.sendMessage(jid, { text: `✅ *පළමු ස්කෑන් කිරීම අවසන්!* (${timeframe})\n\nමේ මොහොතේ කිසිදු Coin එකක පැහැදිලි Trade Setup එකක් හමුවුණේ නැත. මම දිගටම පසුබිමෙන් මාකට් එක අධීක්ෂණය කරමි... 🔍` });
        }

    } catch (error) {
        // මොකක් හරි Error එකක් ආවොත් ඒක චැට් එකටම දානවා
        await conn.sendMessage(jid, { text: `❌ *Scanner Error:* ${error.message}` });
        console.log("Scanner Error:", error.message);
    }
}

// ================== AUTOSCAN COMMAND ==================
cmd({
    pattern: "autoscan",
    desc: "Manage Auto Scanner & Coin List",
    category: "crypto",
    react: "🔍",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    const action = args[0] ? args[0].toLowerCase() : '';
    
    if (action === 'off') {
        if (!isScanning) return reply("⚠️ Auto Scanner දැනටමත් OFF කර ඇත.");
        clearInterval(scanIntervalId);
        isScanning = false;
        return reply("🛑 *Auto Scanner සාර්ථකව OFF කරන ලදී.*");
    }

    if (action === 'on') {
        if (isScanning) return reply("⚠️ Auto Scanner දැනටමත් ON කර ඇත. වෙනස් කිරීමට පළමුව '.autoscan off' මගින් OFF කරන්න.");
        
        let intervalMinutes = args[1] ? parseInt(args[1]) : 15;
        if (isNaN(intervalMinutes) || intervalMinutes < 2) return reply("❌ කරුණාකර නිවැරදි විනාඩි ගණනක් ලබා දෙන්න. \nඋදා: .autoscan on 15 15m");

        // මෙහිදී m.chat වෙනුවට සමහරවිට mek.chat අවශ්‍ය විය හැක, නමුත් සාමාන්‍යයෙන් m.chat හෝ m.key.remoteJid ක්‍රියා කරයි.
        const targetJid = m.chat || mek.key?.remoteJid || m.key?.remoteJid;
        let timeframe = args[2] ? args[2].toLowerCase() : '15m'; 

        isScanning = true;
        reply(`✅ *Auto Scanner ON කරන ලදී!*\n\n⏱️ පරතරය: විනාඩි ${intervalMinutes}\n📊 Timeframe: ${timeframe}\n🪙 Coins: ${scanList.length}\n\n(පළමු Scan එක දැන් ආරම්භ වේ. කරුණාකර රැඳී සිටින්න...)`);
        
        // පළමු ස්කෑන් එක (isFirstRun = true)
        await performScan(conn, targetJid, timeframe, true);

        // දිගටම ස්කෑන් කිරීම
        scanIntervalId = setInterval(async () => {
            await performScan(conn, targetJid, timeframe, false);
        }, intervalMinutes * 60 * 1000);

        return;
    }

    if (action === 'add') {
        if (!args[1]) return reply("❌ කරුණාකර Coin එකක් ලබා දෙන්න. \nඋදා: .autoscan add FET");
        let newCoin = args[1].toUpperCase();
        if (!newCoin.endsWith('USDT')) newCoin += 'USDT';
        if (scanList.includes(newCoin)) return reply(`⚠️ ${newCoin} දැනටමත් Scanner ලිස්ට් එකේ තියෙනවා!`);
        scanList.push(newCoin);
        return reply(`✅ *${newCoin}* සාර්ථකව Scanner ලිස්ට් එකට එකතු කළා!`);
    }

    if (action === 'remove') {
        if (!args[1]) return reply("❌ කරුණාකර Coin එකක් ලබා දෙන්න. \nඋදා: .autoscan remove FET");
        let delCoin = args[1].toUpperCase();
        if (!delCoin.endsWith('USDT')) delCoin += 'USDT';
        const index = scanList.indexOf(delCoin);
        if (index > -1) {
            scanList.splice(index, 1);
            return reply(`🗑️ *${delCoin}* Scanner ලිස්ට් එකෙන් ඉවත් කළා!`);
        } else {
            return reply(`⚠️ ${delCoin} ලිස්ට් එකේ නැහැ!`);
        }
    }

    if (action === 'list') {
        let listMsg = `📋 *Scanner Coins List (${scanList.length})*\n\n` + scanList.map(c => `🔸 ${c.replace('USDT', '')}`).join('\n');
        return reply(listMsg);
    }

    reply(`❌ වැරදි කමාන්ඩ් එකක්!\n\n*භාවිතා කරන ආකාරය:*\n🟢 ON කිරීමට: .autoscan on 15 15m\n🔴 OFF කිරීමට: .autoscan off\n➕ Coin එකතු කිරීමට: .autoscan add WIF\n➖ ඉවත් කිරීමට: .autoscan remove WIF\n📋 ලැයිස්තුව: .autoscan list`);
});
