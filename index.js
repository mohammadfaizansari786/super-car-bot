const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

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

// --- 1. GET NEWS STRICTLY FROM TIER-1 SITES ---
async function getF1News(history) {
  if (!GOOGLE_KEY) return null;

  const today = new Date().getDay();
  const isWeekend = [0, 5, 6].includes(today);

  const f1OnlySites = "(site:racingnews365.com OR site:motorsport.com OR site:autosport.com OR site:the-race.com OR site:skysports.com/f1 OR site:bbc.co.uk/sport/formula1 OR site:formula1.com)";

  let topics = [
    "Verstappen interview OR quote",
    "Hamilton Ferrari news OR interview",
    "Leclerc Ferrari update OR quote",
    "Norris McLaren upgrade OR news",
    "Mercedes F1 official announcement",
    "Christian Horner statement F1",
    "FIA penalty investigation F1",
    "F1 driver contract transfer",
    "F1 breaking news confirmed",
    "major car upgrade F1"
  ];

  if (isWeekend) {
    topics = topics.concat([
      "post race interview controversial F1",
      "grid penalty confirmed F1",
      "crash incident investigation F1",
      "team radio angry F1",
      "stewards decision penalty F1"
    ]);
  }

  const topic = topics[Math.floor(Math.random() * topics.length)];
  const query = `Formula 1 ${topic} -standings -results -"race report" -"session complete" ${f1OnlySites}`;

  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        q: query,
        cx: CX_ID,
        key: GOOGLE_KEY,
        dateRestrict: "d2",
        sort: "date",
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

// --- 2. FORMAT LIKE FORMULA RACERS ---
async function processWithGemini(newsItem) {
  if (!GEMINI_KEY || GEMINI_KEY === "undefined" || GEMINI_KEY === "") {
    console.error("🚨 GEMINI_API_KEY is missing!");
    return null;
  }

  const currentDate = new Date().toDateString();
  const currentYear = new Date().getFullYear();

  // PROMPT UPDATED FOR LONGER, MORE DETAILED TWEETS
  const prompt = `You are the admin of 'Formula Racers', a massive and highly respected Formula 1 news account on X (Twitter).
  Today's exact date is ${currentDate} (${currentYear} season).
  Read the news headline and snippet below, and write a tweet that feels 100% human, highly accurate, and detailed.
  
  CRITICAL RULES:
  1. ZERO AI SPEAK & ZERO FLUFF. Never use phrases like "Buckle up," or "Thoughts?". Deliver the news with absolute objectivity.
  2. STRICT EMOJI RULE: Use EXACTLY ONE emoji, and it MUST be the very first character of the tweet. Do NOT use any other emojis anywhere else in the text.
  3. STRICT 'FORMULA RACERS' FORMATTING:
     For News/Upgrades: 🚨 | [Detailed, objective statement of the news, including important context from the article].
     For Quotes: 🗣️ | [Name]: "Exact quote." [Add a brief follow-up sentence explaining the context if necessary].
  4. LENGTH RULE: Write a longer, more detailed tweet (between 200 and 250 characters). Make it substantial and informative, but STRICTLY do not exceed 250 characters to leave room for the source link.
  5. Use only 1 hashtag maximum (e.g., #F1).
  6. EXACT IMAGE MATCH: Provide a simple 2-3 word search query combining the main person/car and their current team (e.g., "Lewis Hamilton Ferrari", "McLaren F1 car").
  
  News Title: ${newsItem.title}
  News Snippet: ${newsItem.snippet}
  
  Respond STRICTLY in this JSON format:
  {
    "tweet": "Your human-sounding tweet draft here",
    "imageQuery": "Simple 2-3 word search query for the photo"
  }`;

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        safetySettings: safetySettings,
        generationConfig: { responseMimeType: "application/json" }
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI did not return valid JSON");
    
    return JSON.parse(jsonMatch[0]);

  } catch (e) {
    console.error("Gemini SDK Error:", e.message);
    return null;
  }
}

// --- 3. GET STRICTLY ACCURATE PHOTOS ---
async function getImage(query) {
  try {
    const currentYear = new Date().getFullYear();
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        q: `${query} F1 ${currentYear}`,
        cx: CX_ID,
        key: GOOGLE_KEY,
        searchType: "image",
        imgType: "photo", 
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
