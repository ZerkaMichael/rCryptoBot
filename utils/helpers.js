// Utility Helper Functions

// Format numbers with commas
function formatNumber(num) {
  if (typeof num !== 'number') return num;
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: num < 1 ? 6 : 2,
    maximumFractionDigits: num < 1 ? 6 : 2 
  });
}

// Calculate time ago (detailed)
function getTimeAgo(date) {
  if (!date) return 'unknown';
  
  const now = new Date();
  const diffInMs = now - date;
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);
  
  if (diffInDays > 0) {
    return `${diffInDays}d ago`;
  } else if (diffInHours > 0) {
    return `${diffInHours}h ago`;
  } else if (diffInMinutes > 0) {
    return `${diffInMinutes}m ago`;
  } else {
    return 'just now';
  }
}

// Calculate time ago (short format)
function getTimeAgoShort(date) {
  if (!date) return 'unknown';
  
  const now = new Date();
  const diffInMs = now - date;
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMinutes / 60);
  
  if (diffInHours > 0) {
    return `${diffInHours}h ago`;
  } else if (diffInMinutes > 0) {
    return `${diffInMinutes}m ago`;
  } else {
    return 'just now';
  }
}

// Map symbol to CoinGecko ID
function getCoinGeckoId(symbol, symbolMap) {
  return symbolMap[symbol.toUpperCase()] || symbol.toLowerCase();
}

module.exports = {
  formatNumber,
  getTimeAgo,
  getTimeAgoShort,
  getCoinGeckoId
};

