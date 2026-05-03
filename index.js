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

// --- 1. GET SPICY F1 NEWS STRICTLY FROM GOSSIP/QUOTE-HEAVY SITES ---
async function getF1News(history) {
  if (!GOOGLE_KEY) return null;

  const today = new Date().getDay();
  const isWeekend = [0, 5, 6].includes(today);

  // Expanded list of sites that heavily focus on F1 quotes, rumors, and controversies
  const f1OnlySites = "(site:racingnews365.com OR site:planetf1.com OR site:gpfans.com OR site:formu1a.uno OR site:crash.net OR site:f1i.com OR site:f1oversteer.com OR site:grandprix247.com)";

  // Base topics - heavily focused on drama, quotes, and rumors
  let topics = [
    "Verstappen quote OR angry",
    "Hamilton Ferrari slams OR interview",
    "Leclerc OR Sainz controversial",
    "Norris OR Piastri McLaren team radio",
    "Red Bull drama OR Horner quote",
    "F1 upgrade leak OR paddock rumor",
    "Mercedes Toto Wolff hits out",
    "FIA controversial penalty",
    "driver slams F1 OR hits out",
    "F1 gossip OR transfer rumor"
  ];

  // Add weekend specific keywords (crashes, drama, penalties)
  if (isWeekend) {
    topics = topics.concat([
      "FP1 OR FP2 results F1",
      "qualifying pole F1",
      "sprint race drama F1",
      "race winner F1",
      "crash red flag F1",
      "grid penalty controversial F1"
    ]);
  }

  const topic = topics[Math.floor(Math.random() * topics.length)];
  
  // "Formula 1" is appended to ensure sites like Crash.net don't pull MotoGP by accident
  const query = `Formula 1 ${topic} ${f1OnlySites}`;

  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        q: query,
        cx: CX_ID,
        key: GOOGLE_KEY,
        dateRestrict: "d2", // Last 48 hours for a wider net
        sort: "date",       // STILL forces newest article first
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

  const currentDate = new Date().toDateString();
  const currentYear = new Date().getFullYear();

  const prompt = `You are a human admin running a massive Formula 1 fan account on X (Twitter), specifically styled like 'RBR Daily' or 'Motorsport'. 
  Today's exact date is ${currentDate}. You must keep this in mind (e.g. Hamilton is at Ferrari, the new ${currentYear} regs are active).
  Your job is to read the news headline and snippet below, extract the most dramatic, spicy, or breaking piece of information (especially driver quotes), and write a punchy tweet.
  
  CRITICAL RULES:
  1. DO NOT sound like an AI. Never use generic phrases like "Buckle up F1 fans," or "Breaking news!".
  2. Keep the tweet text UNDER 200 CHARACTERS to leave room for the source link.
  3. Formatting for Quotes:
     🗣️ | [Name]: "Exact spicy/controversial quote."
  4. Formatting for Rumors/News:
     🚨 | [The actual news straight to the point].
  5. Add a tiny, organic human reaction at the very end if it fits (e.g., "Huge if true.", "Wow.", "Interesting...").
  6. Use only 1 or 2 relevant hashtags maximum (e.g., #F1).
  7. Provide a highly specific 3-4 word search query to find an exact photo of the subject (e.g., "Max Verstappen angry media", "F1 ${currentYear} leaked floor").
  
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

  console.log(`📰 Found News: ${newsItem.title} from ${newsItem.link}`);

  const content = await processWithGemini(newsItem);
  if (!content || !content.tweet) {
    console.log("❌ Failed to generate tweet content.");
    return;
  }

  // Inject the source link cleanly at the end of the tweet
  const finalTweetText = `${content.tweet}\n\n📰 Source: ${newsItem.link}`;

  console.log(`📝 Tweet Draft: \n${finalTweetText}`);
  console.log(`🖼️ Searching Image Query: ${content.imageQuery}`);

  const imgPath = await getImage(content.imageQuery);

  try {
    let mediaId = null;
    if (imgPath) {
      console.log("📤 Uploading image to Twitter...");
      mediaId = await client.v1.uploadMedia(imgPath);
    }

    const tweetPayload = { text: finalTweetText };
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
