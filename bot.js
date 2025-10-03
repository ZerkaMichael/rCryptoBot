// rCryptoBot - Modular Telegram Cryptocurrency Bot
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config/config');

// Services
const priceFeeds = require('./services/priceFeeds');
const alerts = require('./services/alerts');

// Commands
const commands = require('./commands');

// Initialize bot
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });

// Start price feeds
priceFeeds.startRealTimePricePolling();

// Start alert monitoring
alerts.startAlertMonitoring(
  bot, 
  priceFeeds.getCachedCryptoData,
  priceFeeds.getRealtimePrices
);

// Register all commands
commands.registerCommands(bot, priceFeeds, alerts);

// Error handling
bot.on('polling_error', (error) => {
  console.log('Polling error:', error);
});

console.log('🤖 rCryptoBot is running...');
console.log('⚡ Real-time price feeds enabled (10 second updates with auto-fallback)!');
console.log('Send /start to your bot on Telegram to begin!');
