const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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

// --- 1. GET SPICY / BREAKING F1 NEWS (STRICTLY NEWEST) ---
async function getF1News(history) {
  if (!GOOGLE_KEY) return null;

  // Check if today is a Race Weekend (Friday=5, Saturday=6, Sunday=0)
  const today = new Date().getDay();
  const isWeekend = [0, 5, 6].includes(today);

  // Default weekday queries (Drama, Rumors, Transfers)
  let queries = [
    "F1 driver interview quote",
    "Formula 1 controversial statement",
    "F1 paddock rumors",
    "F1 leaked photos upgrades",
    "F1 team changes drama",
    "Max Verstappen media comments",
    "Lewis Hamilton Ferrari news",
    "Christian Horner statement F1",
    "F1 breaking news controversy"
  ];

  // If it's a Race Weekend, aggressively add live session keywords to the pool!
  if (isWeekend) {
    queries = queries.concat([
      "F1 free practice results today",
      "F1 qualifying lap times updates",
      "F1 race results winner",
      "Formula 1 live updates paddock",
      "F1 sprint race drama",
      "F1 track limits penalty today",
      "F1 crash red flag news"
    ]);
  }

  const query = queries[Math.floor(Math.random() * queries.length)];

  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        q: query,
        cx: CX_ID,
        key: GOOGLE_KEY,
        dateRestrict: "d1", // Strictly the last 24 hours
        sort: "date",       // FORCES Google to sort by the newest article first
        num: 10
      }
    });

    const items = res.data.items || [];
    for (const item of items) {
      if (!history.has(item.link) && !history.has(item.title)) {
        return item;
      }
    }
  } catch (e) {
    console.error("News Search Error:", e.message);
  }
  return null;
}

// --- 2. FORMAT LIKE A HUMAN ADMIN (RBR DAILY STYLE) ---
async function processWithGemini(newsItem) {
  if (!GEMINI_KEY || GEMINI_KEY === "undefined" || GEMINI_KEY === "") {
    console.error("🚨 GEMINI_API_KEY is missing! Please check your GitHub Secrets.");
    return null;
  }

  // Get the exact current date (e.g., "Sun May 03 2026")
  const currentDate = new Date().toDateString();
  const currentYear = new Date().getFullYear();

  // The prompt gives the AI the exact date so it never sounds outdated
  const prompt = `You are a human admin running a massive Formula 1 fan account on X (Twitter), specifically styled like 'RBR Daily' or 'Motorsport'. 
  Today's exact date is ${currentDate}. You must keep this in mind (e.g. Hamilton is at Ferrari, the new ${currentYear} regs are active).
  Your job is to read the news headline and snippet below, extract the most dramatic, controversial, or breaking piece of information, and write a punchy tweet.
  
  CRITICAL RULES:
  1. DO NOT sound like an AI. Never use phrases like "Buckle up F1 fans," "What do you think?", or "Breaking news in the world of F1!".
  2. Be direct and punchy. Real fan accounts just post the raw quote, the rumor, or the controversy.
  3. Formatting for Quotes to the Media:
     🗣️ | [Driver/Team Principal Name]: "Exact controversial/interesting quote."
  4. Formatting for Leaks/Rumors/Changes:
     🚨 | [The actual news straight to the point].
  5. You may add a tiny, organic human reaction at the very end if it fits (e.g., "Huge if true.", "Interesting...", "Wow.", "Thoughts?"), but keep it minimal.
  6. Use only 1 or 2 relevant hashtags maximum (e.g., #F1).
  7. Provide a highly specific 3-4 word search query to find an exact photo of the person, car, or leaked part mentioned (e.g., "Max Verstappen angry media", "F1 ${currentYear} leaked floor", "Toto Wolff serious").
  
  News Title: ${newsItem.title}
  News Snippet: ${newsItem.snippet}
  
  Respond STRICTLY in this JSON format:
  {
    "tweet": "Your human-sounding tweet draft here",
    "imageQuery": "Specific search query for the photo"
  }`;

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);

  } catch (e) {
    console.error("Gemini SDK Error:", e.message);
    return null;
  }
}

// --- 3. GET A RELEVANT IMAGE ---
async function getImage(query) {
  try {
    const currentYear = new Date().getFullYear();
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        q: query + ` F1 ${currentYear} high resolution news photo`,
        cx: CX_ID,
        key: GOOGLE_KEY,
        searchType: "image",
        imgSize: "large",
        num: 3
      }
    });

    const items = res.data.items || [];
    if (items.length > 0) {
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
    
    saveHistory(newsItem.link);
    saveHistory(newsItem.title);

  } catch (error) {
    console.error("Twitter API Error:", error.message);
  } finally {
    if (imgPath && fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
    }
  }
}

run();
