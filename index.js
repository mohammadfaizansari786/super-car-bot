const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// --- CONFIGURATION ---
const HISTORY_FILE = "posted_history.txt";

// --- AUTHENTICATION ---
const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const CX_ID = process.env.SEARCH_ENGINE_ID;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// --- HELPERS ---
function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return new Set();
  const data = fs.readFileSync(HISTORY_FILE, "utf-8");
  return new Set(data.split("\n").filter(line => line.trim() !== ""));
}

function saveHistory(link) {
  fs.appendFileSync(HISTORY_FILE, `${link}\n`);
}

// --- 1. GET RECENT F1 NEWS ---
async function getF1News(history) {
  if (!GOOGLE_KEY) return null;

  // Mix up the queries to keep the news varied
  const queries = [
    "Formula 1 news", "F1 statement", "Red Bull Racing F1", 
    "Mercedes F1 news", "Ferrari F1 news", "Max Verstappen F1", 
    "Lewis Hamilton F1", "McLaren F1 news"
  ];
  const query = queries[Math.floor(Math.random() * queries.length)];

  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        q: query,
        cx: CX_ID,
        key: GOOGLE_KEY,
        dateRestrict: "d2", // Restrict to the last 48 hours for fresh news
        num: 10
      }
    });

    const items = res.data.items || [];
    for (const item of items) {
      // Check if we already posted this exact link or title
      if (!history.has(item.link) && !history.has(item.title)) {
        return item;
      }
    }
  } catch (e) {
    console.error("News Search Error:", e.message);
  }
  return null;
}

// --- 2. FORMAT LIKE 'RBR DAILY' USING GEMINI ---
async function processWithGemini(newsItem) {
  if (!GEMINI_KEY) throw new Error("Gemini API key missing");

  const prompt = `You are a highly engaging Formula 1 news account on X (Twitter), similar to 'RBR Daily', 'F1 Fall', or 'Motorsport'.
  Your task is to take the following news headline and snippet, and rewrite it into a highly natural, engaging tweet.
  
  Rules:
  - If it's a quote or statement, format it naturally like: 🗣️ | [Person]: "Quote"
  - If it's breaking/general news, use emojis like 🚨 or 🗞️.
  - Keep it under 280 characters. 
  - DO NOT wrap the tweet in quotation marks.
  - Include 1 or 2 relevant hashtags (e.g., #F1, #RedBull).
  - Provide a short 3-4 word search query to find a picture related to this news (e.g., "Max Verstappen 2024 F1", "Toto Wolff Mercedes").
  
  News Title: ${newsItem.title}
  News Snippet: ${newsItem.snippet}
  
  Respond STRICTLY in this JSON format:
  {
    "tweet": "The actual tweet text here...",
    "imageQuery": "Search query here"
  }`;

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      }
    );

    const text = res.data.candidates[0].content.parts[0].text;
    
    // Clean up potential markdown formatting from Gemini
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
  } catch (e) {
    console.error("Gemini Generation Error:", e.message);
    return null;
  }
}

// --- 3. GET A RELEVANT IMAGE ---
async function getImage(query) {
  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        q: query + " Formula 1 high resolution",
        cx: CX_ID,
        key: GOOGLE_KEY,
        searchType: "image",
        imgSize: "large",
        num: 3
      }
    });

    const items = res.data.items || [];
    if (items.length > 0) {
      // Pick the first valid image
      const imgUrl = items[0].link;
      const imgPath = path.join(__dirname, `f1_img_${Date.now()}.jpg`);

      const response = await axios({
        url: imgUrl,
        method: "GET",
        responseType: "stream",
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(imgPath);
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      return imgPath;
    }
  } catch (e) {
    console.error("Image Search Error:", e.message);
  }
  return null;
}

// --- MAIN RUNNER ---
async function run() {
  console.log("🏎️ Starting F1 News Bot...");
  const history = loadHistory();

  const newsItem = await getF1News(history);
  if (!newsItem) {
    console.log("No new F1 news found right now. Skipping run.");
    return;
  }

  console.log(`📰 Found News: ${newsItem.title}`);

  const content = await processWithGemini(newsItem);
  if (!content || !content.tweet) {
    console.log("❌ Failed to generate tweet content.");
    return;
  }

  console.log(`📝 Tweet Draft: \n${content.tweet}`);
  console.log(`🖼️ Searching Image Query: ${content.imageQuery}`);

  const imgPath = await getImage(content.imageQuery);

  try {
    let mediaId = null;
    if (imgPath) {
      console.log("📤 Uploading image to Twitter...");
      mediaId = await client.v1.uploadMedia(imgPath);
    }

    const tweetPayload = { text: content.tweet };
    if (mediaId) {
      tweetPayload.media = { media_ids: [mediaId] };
    }

    console.log("🚀 Posting tweet...");
    const resp = await client.v2.tweet(tweetPayload);

    console.log(`✅ Post successful! ID: ${resp.data.id}`);
    
    // Save both the link and title so it doesn't post duplicate news
    saveHistory(newsItem.link);
    saveHistory(newsItem.title);

  } catch (error) {
    console.error("Twitter API Error:", error.message);
  } finally {
    // Clean up downloaded image
    if (imgPath && fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
    }
  }
}

run();
