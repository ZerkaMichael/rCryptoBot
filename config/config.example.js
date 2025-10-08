// Configuration Template - Copy this to config.js and add your API keys
module.exports = {
  // API Keys - REQUIRED
  TELEGRAM_TOKEN: 'YOUR_TELEGRAM_BOT_TOKEN_HERE',
  OPENAI_API_KEY: 'YOUR_OPENAI_API_KEY_HERE',
  TWITTER_BEARER_TOKEN: null, // OPTIONAL: Add Twitter API Bearer Token for Twitter/X news integration
  
  // API Endpoints
  COINGECKO_API: 'https://api.coingecko.com/api/v3',
  
  // Cache Settings
  CACHE_DURATION: 120000, // 2 minutes
  RATE_LIMIT_BACKOFF: 120000, // 2 minutes
  PRICE_FRESHNESS_WINDOW: 15000, // 15 seconds
  
  // Update Intervals
  PRICE_UPDATE_INTERVAL: 10000, // 10 seconds
  ALERT_CHECK_INTERVAL: 30000, // 30 seconds
  
  // Alert Settings
  AUTO_ALERT_THRESHOLD: 3.0, // 3%
  AUTO_ALERT_COOLDOWN: 3600000, // 1 hour
  
  // CoinGecko Symbol Mappings
  SYMBOL_MAP: {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'SOL': 'solana',
    'XRP': 'ripple',
    'HYPE': 'hyperliquid',
    'ASTER': 'astar',
    'WLFI': 'world-liberty-financial',
    'SUI': 'sui',
    'ADA': 'cardano',
    'JUP': 'jupiter-exchange-solana',
    'XCN': 'chain-2',
    'LINK': 'chainlink',
    'AAVE': 'aave',
    'DOT': 'polkadot',
    'UNI': 'uniswap',
    'MATIC': 'matic-network',
    'AVAX': 'avalanche-2',
    'ATOM': 'cosmos',
    'BNB': 'binancecoin',
    'DOGE': 'dogecoin',
    'LTC': 'litecoin',
    'BCH': 'bitcoin-cash',
    'XLM': 'stellar',
    'VET': 'vechain',
    'FIL': 'filecoin',
    'TRX': 'tron'
  }
};

