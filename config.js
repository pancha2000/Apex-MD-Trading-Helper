const fs = require('fs');
const path = require('path');

// Load .env file
if (fs.existsSync('./config.env')) {
    require('dotenv').config({ path: './config.env' });
}

// Enhanced Configuration
const config = {
    // ==================== BOT INFO ====================
    SESSION_ID: process.env.SESSION_ID || "",
    BOT_NAME: process.env.BOT_NAME || "APEX-MD V2",
    VERSION: process.env.VERSION || "2.0.0",
    
    // ==================== PAIRING ====================
    USE_PAIRING_CODE: process.env.USE_PAIRING_CODE || "false",
    PHONE_NUMBER: process.env.PHONE_NUMBER || "",
    
    // ==================== DATABASE ====================
    MONGODB: process.env.MONGODB || "",
    
    // ==================== BOT SETTINGS ====================
    PREFIX: process.env.PREFIX || ".",
    MODE: process.env.MODE || "public", // public, private, inbox, groups
    AUTO_READ: process.env.AUTO_READ || "true",
    AUTO_STATUS_READ: process.env.AUTO_STATUS_READ || "false",
    AUTO_TYPING: process.env.AUTO_TYPING || "false",
    AUTO_RECORDING: process.env.AUTO_RECORDING || "false",
    AUTO_BIO: process.env.AUTO_BIO || "false",
    
    // ==================== OWNER INFO ====================
    OWNER_NAME: process.env.OWNER_NAME || "Owner",
    OWNER_NUMBER: process.env.OWNER_NUMBER || "94xxxxxxxxx",
    SUDO: process.env.SUDO || "94xxxxxxxxx",
    
    // ==================== ALIVE & MENU ====================
    ALIVE_IMG: process.env.ALIVE_IMG || "https://i.imgur.com/VlZ2Y0l.jpeg",
    ALIVE_MSG: process.env.ALIVE_MSG || "✅ *APEX-MD IS ONLINE*",
    MENU_IMG: process.env.MENU_IMG || "https://i.imgur.com/VlZ2Y0l.jpeg",
    
    // ==================== API KEYS ====================
    // AI APIs
    GEMINI_API: process.env.GEMINI_API || "",
    OPENAI_API: process.env.OPENAI_API || "",
    HUGGINGFACE_API: process.env.HUGGINGFACE_API || "",
    
    // Download APIs
    YOUTUBE_API: process.env.YOUTUBE_API || "",
    SPOTIFY_API: process.env.SPOTIFY_API || "",
    
    // Utility APIs
    WEATHER_API: process.env.WEATHER_API || "",
    NEWS_API: process.env.NEWS_API || "",
    CURRENCY_API: process.env.CURRENCY_API || "",
    TRANSLATE_API: process.env.TRANSLATE_API || "",
    
    // Image APIs
    REMOVE_BG_API: process.env.REMOVE_BG_API || "",
    IMGBB_API: process.env.IMGBB_API || "",
    
    // ==================== GROUP SETTINGS ====================
    ANTILINK_ENABLED: process.env.ANTILINK_ENABLED || "true",
    ANTILINK_ACTION: process.env.ANTILINK_ACTION || "kick",
    WELCOME_ENABLED: process.env.WELCOME_ENABLED || "true",
    GOODBYE_ENABLED: process.env.GOODBYE_ENABLED || "true",
    AUTO_STICKER: process.env.AUTO_STICKER || "false",
    
    // ==================== DOWNLOAD SETTINGS ====================
    MAX_DOWNLOAD_SIZE: parseInt(process.env.MAX_DOWNLOAD_SIZE) || 500, // MB
    YOUTUBE_QUALITY: process.env.YOUTUBE_QUALITY || "360p",
    AUDIO_QUALITY: parseInt(process.env.AUDIO_QUALITY) || 128,
    
    // ==================== SECURITY ====================
    BLOCK_SPAM: process.env.BLOCK_SPAM || "true",
    SPAM_COUNT: parseInt(process.env.SPAM_COUNT) || 5,
    BAN_TIME: parseInt(process.env.BAN_TIME) || 3600, // seconds
    ANTI_CALL: process.env.ANTI_CALL || "false",
    ANTI_BOT: process.env.ANTI_BOT || "true",
    
    // ==================== OTHER ====================
    PORT: process.env.PORT || 8000,
    TIME_ZONE: process.env.TIME_ZONE || "Asia/Colombo",
    DEBUG: process.env.DEBUG || "false",
    LOGS: process.env.LOGS || "true",
    
    // ==================== RATE LIMITING ====================
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED || "true",
    RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX) || 10,
    RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
    
    // ==================== PREMIUM FEATURES ====================
    PREMIUM_MODE: process.env.PREMIUM_MODE || "false",
    ECONOMY_ENABLED: process.env.ECONOMY_ENABLED || "false",
    LEVEL_SYSTEM: process.env.LEVEL_SYSTEM || "false",
};

// Validation
if (!config.SESSION_ID) {
    console.log("⚠️  SESSION_ID නැහැ! කරුණාකර config.env file එකේ SESSION_ID එක add කරන්න.");
}

// Helper function to check if user is owner/sudo
config.isOwner = (jid) => {
    const number = jid.split('@')[0];
    const sudoList = config.SUDO.split(',').map(n => n.trim());
    return sudoList.includes(number);
};

// Helper function to check if user is premium
config.isPremium = (jid) => {
    // Implement premium user check from database
    return false;
};

module.exports = config;
