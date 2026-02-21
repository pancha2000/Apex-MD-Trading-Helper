const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');

// Modular Architecture Imports
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

// ================== SPOT COMMAND (ULTIMATE) ==================
cmd({
    pattern: "spot",
    desc: "Ultimate Spot AI with MTF, Divergence & Risk Management",
    category: "crypto",
    react: "🟢",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n*උදා:* ${config.PREFIX}spot BTC 1d`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key එක නැහැ!');
        
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        let timeframe = args[1] ? args[1].toLowerCase() : '1d'; 

        await m.react('⏳');
        await reply(`⏳ *Binance (${timeframe} + Macro TFs) Timeframes විශ්ලේෂණය කරමින් පවතී...*`);

        // MTF Data Fetching
        const currentCandles = await binance.getKlineData(coin, timeframe);
        const tf4hCandles = await binance.getKlineData(coin, '4h', 60);
        const tf1dCandles = await binance.getKlineData(coin, '1d', 60);

        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema4H = indicators.calculateEMA(tf4hCandles);
        const ema1D = indicators.calculateEMA(tf1dCandles);
        
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const marketSMC = smc.analyzeSMC(currentCandles);

        const prompt = `You are a Master Institutional Crypto Spot Trader. Analyze ${coin} for SPOT TRADING.
        Current Price: $${currentPrice}
        
        [MULTI-TIMEFRAME ANALYSIS]
        - Entry TF (${timeframe}) EMA(50): $${emaCurrent}
        - Medium TF (4H) EMA(50): $${ema4H}
        - Macro TF (1D) EMA(50): $${ema1D}

        [INDICATORS & SMC]
        - RSI: ${rsi} | Divergence: ${divergence}
        - ATR (Volatility): ${atr}
        - Resistance: $${marketSMC.resistance} | Support: $${marketSMC.support}
        - Bullish FVG: ${marketSMC.bullishFVG} | Bearish FVG: ${marketSMC.bearishFVG}
        - Fibonacci Golden Zone: $${marketSMC.fib618} - $${marketSMC.fib786}

        Provide a HIGHLY PROFESSIONAL, short analysis using Sinhala mixed with English trading terms.
        Format strictly like this:
        📌 MTF Trend: (Are timeframes aligned? Explain briefly)
        📉 Momentum & Divergence: (Mention Divergence and RSI status)
        🤖 AI Decision: (BUY, HOLD, or WAIT)
        🛡️ Confidence: (e.g., 90%)
        🎯 Spot Targets: 
           - Entry Zone: (Use Fib 0.618 or Support for DCA accumulation)
           - TP: (Target based on Resistance)
           - SL: (Safe Stop Loss or Invalidated point using ATR)
        🧮 Portfolio Risk: (Suggest how much % of portfolio to allocate to this spot bag).

        IMPORTANT: At the very end, output exactly:
        [TARGETS|ENTRY:number|TP:number|SL:number]`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const aiResponse = aiRes.data.choices[0].message.content;

        const outMsg = `
╔═══════════════════════════╗
║  🟢 *PRO SPOT ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe} (MTF Synced)
💲 *Current Price:* $${currentPrice}

${aiResponse}

> 📌 *Track කිරීමට .track ලෙස Reply කරන්න.*`;
        
        await reply(outMsg);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ================== FUTURES COMMAND (ULTIMATE) ==================
cmd({
    pattern: "future",
    alias: ["futures"],
    desc: "Ultimate Futures AI with MTF, Divergence & Risk Management",
    category: "crypto",
    react: "🔴",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n*උදා:* ${config.PREFIX}future BTC 15m`);
        if (!config.GROQ_API) return await reply('❌ GROQ_API key එක නැහැ!');
        
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        let timeframe = args[1] ? args[1].toLowerCase() : '15m'; 

        await m.react('⏳');
        await reply(`⏳ *Binance (${timeframe}, 1h, 4h) Timeframes තුනම විශ්ලේෂණය කරමින් පවතී...*`);

        // MTF Data Fetching
        const currentCandles = await binance.getKlineData(coin, timeframe);
        const hourlyCandles = await binance.getKlineData(coin, '1h', 60); 
        const macroCandles = await binance.getKlineData(coin, '4h', 60);  

        const currentPrice = parseFloat(currentCandles[currentCandles.length - 1][4]).toFixed(2);
        
        const rsi = indicators.calculateRSI(currentCandles);
        const emaCurrent = indicators.calculateEMA(currentCandles);
        const ema1H = indicators.calculateEMA(hourlyCandles);
        const ema4H = indicators.calculateEMA(macroCandles);
        
        const atr = indicators.calculateATR(currentCandles);
        const divergence = indicators.checkDivergence(currentCandles);
        const marketSMC = smc.analyzeSMC(currentCandles);

        const prompt = `You are a Master Institutional Crypto Trader. Analyze ${coin} for FUTURES TRADING.
        Current Price: $${currentPrice}
        
        [MULTI-TIMEFRAME ANALYSIS]
        - Entry TF (${timeframe}) EMA(50): $${emaCurrent}
        - Medium TF (1H) EMA(50): $${ema1H}
        - Macro TF (4H) EMA(50): $${ema4H}

        [INDICATORS & SMC]
        - RSI: ${rsi} | Divergence: ${divergence}
        - ATR (Volatility): ${atr}
        - Resistance: $${marketSMC.resistance} | Support: $${marketSMC.support}
        - Bullish FVG: ${marketSMC.bullishFVG} | Bearish FVG: ${marketSMC.bearishFVG}
        - Fibonacci Golden Zone: $${marketSMC.fib618} - $${marketSMC.fib786}

        Provide a HIGHLY PROFESSIONAL, short analysis using Sinhala mixed with English trading terms.
        Format strictly like this:
        📌 MTF Trend: (Are ${timeframe}, 1H, and 4H aligned? Explain briefly)
        📉 Momentum & Divergence: (Mention if there is Divergence and what RSI shows)
        🤖 AI Decision: (LONG, SHORT, or WAIT)
        🛡️ Confidence: (e.g., 90%)
        🎯 Trade Setup: 
           - Entry: (Use Fib 0.618 or FVG for precise entry)
           - TP: (Target based on Resistance/Support)
           - SL: (Safe Stop Loss using ATR)
        🧮 Risk Management: (Suggest exactly how much margin % to use and maximum leverage based on ATR Volatility).

        IMPORTANT: At the very end, output exactly:
        [TARGETS|ENTRY:number|TP:number|SL:number]`;

        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const aiRes = await axios.post(groqUrl, {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });

        const aiResponse = aiRes.data.choices[0].message.content;

        const outMsg = `
╔═══════════════════════════╗
║ 🔴 *PRO FUTURES ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe} (Synced with 1H & 4H)
💲 *Current Price:* $${currentPrice}

${aiResponse}

> 📌 *Track කිරීමට .track ලෙස Reply කරන්න.*`;
        
        await reply(outMsg);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ================== TRACK COMMAND ==================
cmd({
    pattern: "track",
    desc: "Save and track a crypto trade",
    category: "crypto",
    react: "🎯",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        if (!m.quoted) return await reply('❌ කරුණාකර AI එකෙන් දුන්න Analysis මැසේජ් එකට Reply කරමින් .track ලෙස යවන්න.');
        
        const quotedText = m.quoted.conversation || m.quoted.extendedTextMessage?.text || m.quoted.text || m.quoted.body || "";
        if (!quotedText) return await reply('❌ Quoted මැසේජ් එක කියවීමට නොහැක.');

        const coinMatch = quotedText.match(/🪙 \*Coin:\* ([A-Z]+)/);
        if (!coinMatch) return await reply('❌ මෙය නිවැරදි Analysis පණිවිඩයක් නොවේ.');
        const coin = coinMatch[1] + 'USDT';
        const type = quotedText.includes('SPOT') ? 'spot' : 'future';

        const targetMatch = quotedText.match(/\[TARGETS\|ENTRY:\s*([0-9.]+)\s*\|TP:\s*([0-9.]+)\s*\|SL:\s*([0-9.]+)\s*\]/);
        
        if (!targetMatch) return await reply('❌ AI එක විසින් Entry/TP/SL දත්ත ලබා දී නැත.');

        const entry = parseFloat(targetMatch[1]);
        const tp = parseFloat(targetMatch[2]);
        const sl = parseFloat(targetMatch[3]);

        await db.saveTrade({
            userJid: m.sender,
            coin: coin,
            type: type,
            entry: entry,
            tp: tp,
            sl: sl
        });

        await reply(`✅ *${coin}* Trade එක සාර්ථකව Track කිරීම ආරම්භ කළා!\n\n🎯 *Entry:* $${entry}\n💰 *TP:* $${tp}\n🛑 *SL:* $${sl}\n\n(Trade එකේ තත්වය වෙනස් වූ විට මම ඔබව දැනුවත් කරමි)`);
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
        await reply('❌ Error: ' + e.message);
    }
});
