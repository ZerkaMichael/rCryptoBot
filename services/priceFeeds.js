// Price Feeds Service - Multi-source cryptocurrency price fetching
const axios = require('axios');
const config = require('../config/config');
const { getCoinGeckoId } = require('../utils/helpers');

// Storage
const realtimePrices = new Map();
const priceCache = new Map();
let lastRateLimitTime = 0;

// Get cryptocurrency data from CoinGecko
async function getCryptoData(symbol) {
  try {
    const response = await axios.get(`${config.COINGECKO_API}/simple/price`, {
      params: {
        ids: getCoinGeckoId(symbol, config.SYMBOL_MAP),
        vs_currencies: 'usd',
        include_24hr_change: true,
        include_market_cap: true,
        include_24hr_vol: true
      }
    });
    
    const coinId = getCoinGeckoId(symbol, config.SYMBOL_MAP);
    const data = response.data[coinId];
    
    if (!data) return null;
    
    return {
      price: data.usd,
      change24h: data.usd_24h_change?.toFixed(2) || 'N/A',
      marketCap: data.usd_market_cap || 'N/A',
      volume24h: data.usd_24h_vol || 'N/A'
    };
  } catch (error) {
    console.error('Error fetching crypto data:', error.message);
    return null;
  }
}

// Fetch from CryptoCompare
async function fetchCryptoComparePrices() {
  try {
    const symbols = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'UNI', 'LINK', 'AAVE', 'MATIC', 'AVAX', 'SUI', 'ATOM', 'ARB'];
    const symbolsStr = symbols.join(',');

    const response = await axios.get('https://min-api.cryptocompare.com/data/pricemultifull', {
      params: {
        fsyms: symbolsStr,
        tsyms: 'USD'
      },
      timeout: 8000
    });

    if (response.data && response.data.RAW) {
      const data = response.data.RAW;
      
      Object.keys(data).forEach(symbol => {
        const coinData = data[symbol].USD;
        realtimePrices.set(symbol, {
          price: parseFloat(coinData.PRICE),
          change24h: parseFloat(coinData.CHANGEPCT24HOUR).toFixed(2),
          volume24h: parseFloat(coinData.TOTALVOLUME24HTO),
          marketCap: parseFloat(coinData.MKTCAP),
          timestamp: Date.now(),
          source: 'cryptocompare'
        });
      });
      
      console.log(`✅ Updated ${realtimePrices.size} real-time prices from CryptoCompare`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ CryptoCompare error:', error.message);
    return false;
  }
}

// Fallback: Fetch from CoinCap
async function fetchCoinCapPrices() {
  try {
    const symbols = ['bitcoin', 'ethereum', 'solana', 'ripple', 'hyperliquid', 'astar', 'world-liberty-financial'];
    const symbolMap = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'solana': 'SOL',
      'ripple': 'XRP',
      'hyperliquid': 'HYPE',
      'astar': 'ASTER',
      'world-liberty-financial': 'WLFI'
    };

    const response = await axios.get('https://api.coincap.io/v2/assets', {
      params: { limit: 100 },
      timeout: 8000
    });

    if (response.data && response.data.data) {
      const assets = response.data.data;
      
      assets.forEach(asset => {
        const assetId = asset.id;
        const symbol = symbolMap[assetId] || asset.symbol?.toUpperCase();
        
        if (symbol && symbols.includes(assetId)) {
          realtimePrices.set(symbol, {
            price: parseFloat(asset.priceUsd),
            change24h: parseFloat(asset.changePercent24Hr).toFixed(2),
            volume24h: parseFloat(asset.volumeUsd24Hr),
            marketCap: parseFloat(asset.marketCapUsd),
            timestamp: Date.now(),
            source: 'coincap'
          });
        }
      });
      
      console.log(`✅ Updated ${realtimePrices.size} real-time prices from CoinCap`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ CoinCap error:', error.message);
    return false;
  }
}

// Emergency fallback: CoinGecko batch
async function fetchFromCoinGeckoFallback() {
  try {
    const symbols = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'UNI', 'LINK', 'AAVE'];
    let updated = 0;

    for (const symbol of symbols) {
      try {
        const data = await getCryptoData(symbol);
        if (data) {
          realtimePrices.set(symbol, {
            ...data,
            timestamp: Date.now(),
            source: 'coingecko-fallback'
          });
          updated++;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        // Skip
      }
    }

    if (updated > 0) {
      console.log(`✅ Updated ${updated} prices from CoinGecko fallback`);
    }
  } catch (error) {
    console.error('❌ All price sources failed:', error.message);
  }
}

// Multi-source price fetcher
async function fetchRealtimePrices() {
  const success1 = await fetchCryptoComparePrices();
  if (success1) return;

  console.log('⚠️ Trying CoinCap as fallback...');
  const success2 = await fetchCoinCapPrices();
  if (success2) return;

  console.log('⚠️ Using CoinGecko fallback (may be slower)...');
  await fetchFromCoinGeckoFallback();
}

// Main function to get cached crypto data
async function getCachedCryptoData(symbol, forceRefresh = false) {
  const cacheKey = symbol.toLowerCase();
  const now = Date.now();
  const symbolUpper = symbol.toUpperCase();

  // Priority 1: Check real-time prices
  if (realtimePrices.has(symbolUpper)) {
    const realtimeData = realtimePrices.get(symbolUpper);
    if (now - realtimeData.timestamp < config.PRICE_FRESHNESS_WINDOW) {
      console.log(`⚡ Using real-time price for ${symbol}: $${realtimeData.price.toFixed(2)} (${realtimeData.source})`);
      return realtimeData;
    }
  }

  // Check rate limit backoff
  if (now - lastRateLimitTime < config.RATE_LIMIT_BACKOFF) {
    console.log(`⏳ Rate limit backoff active for ${symbol}, using cache...`);
    if (priceCache.has(cacheKey)) {
      return priceCache.get(cacheKey);
    } else if (realtimePrices.has(symbolUpper)) {
      return realtimePrices.get(symbolUpper);
    } else {
      console.log(`❌ No cached data available for ${symbol} during backoff`);
      return null;
    }
  }

  // Check valid cache
  if (!forceRefresh && priceCache.has(cacheKey)) {
    const cachedData = priceCache.get(cacheKey);
    if (now - cachedData.timestamp < config.CACHE_DURATION) {
      console.log(`💾 Using cached price for ${symbol}: $${cachedData.price.toFixed(2)}`);
      return cachedData;
    }
  }

  // Fetch fresh from CoinGecko
  console.log(`🌐 Fetching price for ${symbol} from CoinGecko...`);
  try {
    const freshData = await getCryptoData(symbol);

    if (freshData) {
      priceCache.set(cacheKey, {
        ...freshData,
        timestamp: now,
        source: 'coingecko'
      });
      console.log(`✅ Fresh price cached for ${symbol}: $${freshData.price.toFixed(2)}`);
      return freshData;
    }
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.log(`🚫 Rate limit hit for ${symbol}, activating backoff...`);
      lastRateLimitTime = now;

      if (priceCache.has(cacheKey)) {
        console.log(`💾 Using stale cache for ${symbol} due to rate limit`);
        return priceCache.get(cacheKey);
      } else if (realtimePrices.has(symbolUpper)) {
        return realtimePrices.get(symbolUpper);
      }
    }
    throw error;
  }

  return null;
}

// Start real-time polling
function startRealTimePricePolling() {
  console.log('⚡ Starting real-time price polling (multi-source: CryptoCompare → CoinCap → CoinGecko)...');
  
  fetchRealtimePrices();
  setInterval(fetchRealtimePrices, config.PRICE_UPDATE_INTERVAL);
  
  console.log('✅ Real-time price feeds active! (10 second updates with auto-fallback)');
}

// Getters
function getRealtimePrices() {
  return realtimePrices;
}

module.exports = {
  getCachedCryptoData,
  getCryptoData,
  startRealTimePricePolling,
  getRealtimePrices,
  fetchRealtimePrices
};

