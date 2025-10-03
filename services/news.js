// News Service - Aggregates and analyzes cryptocurrency news from multiple sources
const axios = require('axios');
const OpenAI = require('openai');
const config = require('../config/config');
const activityDetector = require('./activityDetector');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY
});

// Get quality Reddit news
async function getQualityRedditNews(symbol) {
  try {
    const premiumSubreddits = [
      { name: 'cryptocurrency', quality: 8, minScore: 100, minComments: 20 },
      { name: 'CryptoMarkets', quality: 10, minScore: 50, minComments: 15 },
      { name: 'Bitcoin', quality: 9, minScore: 75, minComments: 15 },
      { name: 'ethereum', quality: 9, minScore: 75, minComments: 15 },
      { name: 'defi', quality: 8, minScore: 50, minComments: 10 },
      { name: 'CryptoCurrencyTrading', quality: 7, minScore: 40, minComments: 10 },
      { name: symbol.toLowerCase(), quality: 6, minScore: 30, minComments: 5 }
    ];
    
    const qualityNewsItems = [];
    
    for (const subredditInfo of premiumSubreddits) {
      const subreddit = subredditInfo.name;
      try {
        const [hotResponse, topResponse] = await Promise.all([
          axios.get(`https://www.reddit.com/r/${subreddit}/hot.json`, {
            params: { limit: 30 },
            headers: { 'User-Agent': 'rCryptoBot/1.0' }
          }),
          axios.get(`https://www.reddit.com/r/${subreddit}/top.json`, {
            params: { limit: 30, t: 'week' },
            headers: { 'User-Agent': 'rCryptoBot/1.0' }
          })
        ]);
        
        const allPosts = [
          ...(hotResponse.data?.data?.children || []),
          ...(topResponse.data?.data?.children || [])
        ];
        
        for (const post of allPosts) {
          const postData = post.data;
          
          if (postData.title && 
              postData.title.toLowerCase().includes(symbol.toLowerCase()) &&
              postData.score >= subredditInfo.minScore &&
              postData.num_comments >= subredditInfo.minComments &&
              !postData.over_18 &&
              !postData.removed &&
              postData.upvote_ratio > 0.75 &&
              !isMemeOrLowQuality(postData) &&
              isSubstantiveDiscussion(postData)) {
            
            const content = await getRedditPostContent(postData.permalink);
            
            qualityNewsItems.push({
              title: postData.title,
              content: content,
              url: `https://reddit.com${postData.permalink}`,
              source: `r/${subreddit}`,
              score: postData.score,
              created: new Date(postData.created_utc * 1000),
              comments: postData.num_comments,
              upvoteRatio: postData.upvote_ratio,
              author: postData.author,
              type: 'reddit_quality',
              qualityScore: calculateEnhancedQualityScore(postData, subredditInfo.quality),
              flair: postData.link_flair_text || '',
              isDiscussion: postData.link_flair_text?.toLowerCase().includes('discussion') || false
            });
          }
        }
      } catch (error) {
        console.log(`Error fetching quality posts from r/${subreddit}:`, error.message);
      }
    }
    
    return qualityNewsItems
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, 8);
      
  } catch (error) {
    console.error('Error fetching quality Reddit news:', error.message);
    return [];
  }
}

// Helper functions for Reddit quality filtering
function isMemeOrLowQuality(postData) {
  const title = postData.title.toLowerCase();
  const selftext = (postData.selftext || '').toLowerCase();
  
  const memeIndicators = [
    'moon', 'lambo', 'wen', 'hodl', 'diamond hands', '💎🙌', '🚀', 
    'to the moon', 'wagmi', 'ngmi', 'lfg', 'gm', 'ser', 'fren',
    'ape', 'degen', 'chad', 'virgin', 'based', 'cringe', 'cope',
    'meme', 'joke', 'funny', 'lol', 'lmao', 'rofl', 'comedy',
    'shitpost', 'shitcoin', 'pump', 'dump', 'rug', 'scam'
  ];
  
  const flair = (postData.link_flair_text || '').toLowerCase();
  if (flair.includes('meme') || flair.includes('comedy') || flair.includes('fun')) {
    return true;
  }
  
  const memeCount = memeIndicators.filter(indicator => title.includes(indicator)).length;
  if (memeCount >= 2) return true;
  
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  const emojiMatches = title.match(emojiRegex);
  if (emojiMatches && emojiMatches.length > 3) return true;
  
  const words = title.split(' ');
  const capsWords = words.filter(word => word.length > 3 && word === word.toUpperCase());
  if (capsWords.length > words.length * 0.5) return true;
  
  if (title.length < 20 && !selftext) return true;
  
  if ((title.includes('$') || title.includes('price')) && 
      (title.includes('eoy') || title.includes('prediction') || title.includes('target')) &&
      (!selftext || selftext.length < 100)) {
    return true;
  }
  
  return false;
}

function isSubstantiveDiscussion(postData) {
  const selftext = postData.selftext || '';
  const title = postData.title || '';
  
  const qualityIndicators = [
    'analysis', 'technical', 'fundamental', 'research', 'dd', 'due diligence',
    'whitepaper', 'tokenomics', 'roadmap', 'development', 'update', 'news',
    'partnership', 'integration', 'adoption', 'use case', 'utility',
    'comparison', 'versus', 'pros and cons', 'discussion', 'thoughts'
  ];
  
  const hasQualityIndicators = qualityIndicators.some(indicator => 
    title.toLowerCase().includes(indicator) || selftext.toLowerCase().includes(indicator)
  );
  
  const hasSubstantiveContent = selftext.length > 200;
  const hasLinks = selftext.includes('http://') || selftext.includes('https://');
  const engagementRatio = postData.num_comments / Math.max(postData.score, 1);
  const hasGoodEngagement = engagementRatio > 0.1;
  
  return hasQualityIndicators || (hasSubstantiveContent && hasGoodEngagement) || 
         (hasLinks && postData.num_comments > 20);
}

function calculateEnhancedQualityScore(postData, subredditQuality) {
  const baseScore = postData.score || 0;
  const commentWeight = (postData.num_comments || 0) * 3;
  const ratioBonus = (postData.upvote_ratio || 0) * 150;
  const timeDecay = Math.max(0, 1 - (Date.now() - postData.created_utc * 1000) / (7 * 24 * 60 * 60 * 1000));
  const flairBonus = postData.link_flair_text?.toLowerCase().includes('discussion') ? 50 : 0;
  const contentBonus = Math.min((postData.selftext?.length || 0) / 10, 100);
  const subredditMultiplier = 1 + (subredditQuality / 10);
  const engagementQuality = Math.min((postData.num_comments / Math.max(postData.score, 1)) * 100, 50);
  
  const totalScore = (baseScore + commentWeight + ratioBonus + flairBonus + contentBonus + engagementQuality) * 
                     (1 + timeDecay * 0.3) * subredditMultiplier;
  
  return totalScore;
}

async function getRedditPostContent(permalink) {
  try {
    const response = await axios.get(`https://www.reddit.com${permalink}.json`, {
      headers: { 'User-Agent': 'rCryptoBot/1.0' },
      timeout: 3000
    });
    
    if (response.data && response.data[0]?.data?.children?.[0]?.data) {
      const postData = response.data[0].data.children[0].data;
      let content = postData.selftext || '';
      
      if (response.data[1]?.data?.children) {
        const topComments = response.data[1].data.children
          .slice(0, 3)
          .map(comment => comment.data?.body)
          .filter(body => body && body !== '[deleted]' && body !== '[removed]')
          .join(' ');
        
        if (topComments) {
          content += ' Top comments: ' + topComments;
        }
      }
      
      return content.substring(0, 1000);
    }
  } catch (error) {
    console.log('Error fetching post content:', error.message);
  }
  return '';
}

// Aggregate all news sources
async function aggregateQualityNews(symbol, getCachedCryptoData) {
  try {
    console.log(`Aggregating high-quality news and unusual activity for ${symbol}...`);

    const [qualityReddit, unusualActivity] = await Promise.all([
      getQualityRedditNews(symbol),
      activityDetector.detectUnusualActivity(symbol, getCachedCryptoData)
    ]);

    return {
      reddit: qualityReddit,
      general: [], // Simplified - can add RSS feeds later if needed
      twitter: [],
      unusualActivity: unusualActivity,
      timestamp: new Date(),
      totalQualitySources: qualityReddit.length,
      dataQuality: 'premium',
      activityDetected: unusualActivity.length > 0
    };
  } catch (error) {
    console.error('Error aggregating quality news:', error.message);
    return {
      reddit: [],
      general: [],
      twitter: [],
      unusualActivity: [],
      timestamp: new Date(),
      totalQualitySources: 0,
      dataQuality: 'limited',
      activityDetected: false,
      error: 'Failed to fetch some premium news sources'
    };
  }
}

// Get AI-powered comprehensive briefing
async function getComprehensiveBriefing(newsData, symbol) {
  try {
    const contentSections = [];
    
    if (newsData.reddit && newsData.reddit.length > 0) {
      contentSections.push("=== REDDIT COMMUNITY DISCUSSIONS ===");
      newsData.reddit.forEach((item, index) => {
        contentSections.push(`\nDiscussion ${index + 1} (${item.score || 0} upvotes, ${item.comments || 0} comments):`);
        contentSections.push(`Title: ${item.title}`);
        if (item.content && item.content.length > 50) {
          contentSections.push(`Content: ${item.content}`);
        }
        contentSections.push(`Source: ${item.source}`);
      });
    }

    if (newsData.unusualActivity && newsData.unusualActivity.length > 0) {
      contentSections.push("\n\n=== UNUSUAL MARKET ACTIVITY DETECTED ===");
      newsData.unusualActivity.forEach((activity, index) => {
        contentSections.push(`\nActivity ${index + 1} (${activity.severity} severity, ${activity.impact} impact):`);
        contentSections.push(`Type: ${activity.type.replace('_', ' ').toUpperCase()}`);
        contentSections.push(`Description: ${activity.description}`);
      });
    }
    
    if (contentSections.length === 0) {
      return {
        briefing: `No recent news or discussions found for ${symbol}.`,
        totalSources: 0,
        analysis: {
          marketActivity: 'Low',
          newsVolume: 'Minimal',
          communityEngagement: 'Limited'
        }
      };
    }
    
    const fullContent = contentSections.join('\n');
    
    const prompt = `You are a senior cryptocurrency market analyst. Analyze the following high-quality data about ${symbol}:

${fullContent}

Provide a CONCISE briefing in this format:

EXECUTIVE SUMMARY:
[2-3 sentences capturing key developments]

KEY DEVELOPMENTS:
• [Specific development 1]
• [Specific development 2]
• [Up to 4 key points]

MARKET ACTIVITY:
[Explain unusual activity if detected, otherwise summarize market behavior]

COMMUNITY INSIGHTS:
[What sophisticated investors are discussing]

OUTLOOK:
[Professional assessment - what to monitor]

Keep it under 1500 characters total.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a senior cryptocurrency market analyst. Provide professional, structured analysis reports."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1200,
      temperature: 0.2
    });

    const briefingText = completion.choices[0].message.content;
    
    const analysis = {
      marketActivity: determineMarketActivity(newsData),
      newsVolume: newsData.general?.length > 2 ? 'High' : newsData.general?.length > 0 ? 'Medium' : 'Low',
      communityEngagement: determineCommunityEngagement(newsData.reddit)
    };

    return {
      briefing: briefingText,
      totalSources: (newsData.reddit?.length || 0) + (newsData.general?.length || 0),
      analysis: analysis,
      aiGenerated: true,
      modelUsed: 'GPT-3.5-Turbo'
    };

  } catch (error) {
    console.error('Error getting comprehensive briefing:', error.message);
    
    const totalSources = (newsData.reddit?.length || 0) + (newsData.general?.length || 0);
    let fallbackBriefing = `**BRIEFING FOR ${symbol}**\n\n`;
    
    if (totalSources === 0) {
      fallbackBriefing += `**EXECUTIVE SUMMARY:**\nNo recent news or community discussions found for ${symbol}.`;
    } else {
      fallbackBriefing += `**EXECUTIVE SUMMARY:**\nFound ${totalSources} recent sources discussing ${symbol}.\n\n`;
      
      if (newsData.reddit && newsData.reddit.length > 0) {
        const topPost = newsData.reddit.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        fallbackBriefing += `**KEY DISCUSSION:**\n"${topPost.title}" (${topPost.score || 0} upvotes)\n\n`;
      }
      
      fallbackBriefing += `**NOTE:** AI analysis temporarily unavailable.`;
    }
    
    return {
      briefing: fallbackBriefing,
      totalSources: totalSources,
      analysis: {
        marketActivity: 'Unknown',
        newsVolume: 'Limited',
        communityEngagement: 'Unknown'
      },
      error: 'AI analysis unavailable'
    };
  }
}

// Generate professional briefing
function generateProfessionalBriefing(newsData, comprehensiveBriefing, symbol) {
  let output = `📊 ${symbol} PREMIUM BRIEFING\n\n`;

  output += `⭐ PREMIUM DATA QUALITY DASHBOARD\n`;
  output += `• Data Quality: ${newsData.dataQuality || 'Premium'}\n`;
  output += `• Market Activity: ${comprehensiveBriefing.analysis.marketActivity}\n`;
  output += `• News Volume: ${comprehensiveBriefing.analysis.newsVolume}\n`;
  output += `• Community Engagement: ${comprehensiveBriefing.analysis.communityEngagement}\n`;
  output += `• Premium Sources: ${newsData.totalQualitySources || comprehensiveBriefing.totalSources}\n\n`;

  const briefingText = comprehensiveBriefing.briefing || '';
  if (briefingText.length > 2000) {
    output += briefingText.substring(0, 2000) + '...\n\n*[Briefing truncated]*\n\n';
  } else {
    output += `${briefingText}\n\n`;
  }

  if (newsData.unusualActivity && newsData.unusualActivity.length > 0) {
    output += `🚨 UNUSUAL MARKET ACTIVITY ALERT\n`;
    
    const buyActivities = newsData.unusualActivity.filter(a => a.type === 'large_buys_24h');
    const sellActivities = newsData.unusualActivity.filter(a => a.type === 'large_sells_24h');
    const flowActivities = newsData.unusualActivity.filter(a => 
      ['exchange_flow_detailed', 'net_flow_24h', 'estimated_flow_24h'].includes(a.type)
    );
    const otherActivities = newsData.unusualActivity.filter(a => 
      !['large_buys_24h', 'large_sells_24h', 'exchange_flow_detailed', 'net_flow_24h', 'estimated_flow_24h'].includes(a.type)
    );

    if (buyActivities.length > 0) {
      buyActivities.forEach((activity) => {
        const severityEmoji = activity.severity === 'high' ? '🔴' : '🟡';
        output += `${severityEmoji}📈 LARGE BUYS DETECTED:\n${activity.description}\n\n`;
      });
    }

    if (sellActivities.length > 0) {
      sellActivities.forEach((activity) => {
        const severityEmoji = activity.severity === 'high' ? '🔴' : '🟡';
        output += `${severityEmoji}📉 LARGE SELLS DETECTED:\n${activity.description}\n\n`;
      });
    }

    if (flowActivities.length > 0) {
      flowActivities.forEach((activity) => {
        const severityEmoji = activity.severity === 'high' ? '🔴' : '🟡';
        const impactEmoji = activity.impact === 'High' ? '⚡' : '📊';
        
        if (activity.type === 'exchange_flow_detailed') {
          output += `${severityEmoji}${impactEmoji} EXCHANGE FLOW DETAILED:\n${activity.description}\n\n`;
        } else if (activity.type === 'net_flow_24h') {
          output += `${severityEmoji}${impactEmoji} 24H NET FLOW:\n${activity.description}\n\n`;
        } else if (activity.type === 'estimated_flow_24h') {
          output += `${severityEmoji}${impactEmoji} 24H PRESSURE ANALYSIS:\n${activity.description}\n\n`;
        }
      });
    }

    if (otherActivities.length > 0) {
      const topOtherActivities = otherActivities.slice(0, 3);
      topOtherActivities.forEach((activity) => {
        const severityEmoji = activity.severity === 'high' ? '🔴' :
                             activity.severity === 'medium' ? '🟡' : '🟢';
        const impactEmoji = activity.impact === 'Very High' ? '⚠️' :
                           activity.impact === 'High' ? '⚡' :
                           activity.impact === 'Medium' ? '📊' : 'ℹ️';

        const cleanDescription = (activity.description || '').replace(/[*_`[\]()]/g, '').substring(0, 250);
        const cleanType = (activity.type || 'unknown').replace(/_/g, ' ').toUpperCase();
        output += `${severityEmoji}${impactEmoji} ${cleanType}:\n${cleanDescription}\n\n`;
      });
    }
  }

  output += `📊 DATA SOURCES\n`;
  output += `• Reddit: ${newsData.reddit?.length || 0} | News: ${newsData.general?.length || 0} | Activity: ${newsData.activityDetected ? '🟢' : '⚪'}\n\n`;

  if (comprehensiveBriefing.aiGenerated) {
    output += `🤖 AI Analysis | ⏰ ${new Date().toLocaleString()}\n`;
  }

  output += `💰 /price ${symbol} | 🔄 /news ${symbol}`;

  if (output.length > 4000) {
    output = output.substring(0, 3950) + '\n\n*[Message truncated]*';
  }

  return output;
}

function determineMarketActivity(newsData) {
  const totalActivity = (newsData.reddit?.length || 0) + (newsData.general?.length || 0);
  if (totalActivity >= 5) return 'High';
  if (totalActivity >= 2) return 'Medium';
  return 'Low';
}

function determineCommunityEngagement(redditData) {
  if (!redditData || redditData.length === 0) return 'Low';
  
  const avgScore = redditData.reduce((sum, post) => sum + (post.score || 0), 0) / redditData.length;
  const totalComments = redditData.reduce((sum, post) => sum + (post.comments || 0), 0);
  
  if (avgScore > 50 && totalComments > 100) return 'Very High';
  if (avgScore > 20 && totalComments > 50) return 'High';
  if (avgScore > 5 && totalComments > 10) return 'Medium';
  return 'Low';
}

module.exports = {
  getQualityRedditNews,
  aggregateQualityNews,
  getComprehensiveBriefing,
  generateProfessionalBriefing
};

