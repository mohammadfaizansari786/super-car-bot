const { GoogleGenerativeAI } = require("@google/generative-ai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// --- CONFIGURATION ---
const MAX_LENGTH = 240;
const HISTORY_FILE = "posted_history.txt";

// --- BACKUP LIBRARIES ---
const WIKI_CATEGORIES = ["Category:Supercars", "Category:Sports_cars", "Category:Grand_tourers", "Category:Rally_cars"];
const BACKUP_TOPICS = [
  "McLaren F1", "Ferrari F40", "Porsche 959", "Bugatti Chiron", "Pagani Huayra",
  "Lexus LFA", "Ford GT40", "Nissan Skyline GT-R R34", "Mazda 787B",
  "Lamborghini Countach", "Mercedes 300SL", "Aston Martin Valkyrie",
  "Koenigsegg Jesko", "BMW E38", "Lancia Stratos", "Audi Quattro S1"
];
const DOOMSDAY_TWEETS = [
  "Spotlight: Ferrari F40 🏎️\n\nRaw, twin-turbocharged perfection. The last Ferrari Enzo signed off on.\n\nA true driver's car. 🏁\n\n#Ferrari #Legends",
  "Spotlight: McLaren F1 🇬🇧\n\nGold-lined engine bay. Center seat. The fastest naturally aspirated car ever.\n\nGordon Murray's masterpiece. 🧵\n\n#McLaren #Icons",
  "Spotlight: Mazda 787B 🇯🇵\n\nThe rotary engine's finest hour. The first Japanese car to win Le Mans.\n\nThat 4-rotor scream is unforgettable. 🔊\n\n#Mazda #Rotary"
];

// --- AUTHENTICATION ---
const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const CX_ID = process.env.SEARCH_ENGINE_ID;

// --- HELPERS ---
function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return new Set();
  const data = fs.readFileSync(HISTORY_FILE, "utf-8");
  return new Set(data.split("\n").filter(line => line.trim() !== ""));
}

function saveHistory(topic) {
  fs.appendFileSync(HISTORY_FILE, `${topic}\n`);
}

function generateSessionId() {
  return crypto.randomBytes(4).toString("hex");
}

// --- 1. WEB FETCH (WIKIPEDIA) ---
async function getWikiCar(history) {
  try {
    const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
    const url = "https://en.wikipedia.org/w/api.php";
    const res = await axios.get(url, {
      params: { action: "query", list: "categorymembers", cmtitle: category, cmlimit: 50, format: "json", origin: "*" }
    });
    const members = res.data.query.categorymembers || [];
    const valid = members.filter(m => !m.title.startsWith("Category:") && !history.has(m.title));
    return valid.length > 0 ? valid[Math.floor(Math.random() * valid.length)].title : null;
  } catch (e) { return null; }
}

// --- 2. GENERATE CONTENT (GEMINI) ---
async function generateTweets(carName) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Write 3 viral tweets about '${carName}'. 
    Tweet 1: Intro (Hook). 
    Tweet 2: Specs (Bullet points). 
    Tweet 3: Legacy (Hashtags). 
    Separate tweets strictly with '|||'. 
    Max ${MAX_LENGTH} chars each. No markdown bolding.`;

    const result = await model.generateContent(prompt);
    const parts = result.response.text().split('|||').map(p => p.trim());
    if (parts.length === 3) return parts;
  } catch (e) {
    console.error("Gemini Failed:", e.message);
  }
  // Fallback Template
  return [
    `Legendary Machine: ${carName} 🏎️\n\nA masterclass in automotive engineering and design.\n\n(Thread 🧵)`,
    `The ${carName} is defined by its incredible performance and soul-stirring sound. 🏁`,
    `Is the ${carName} in your dream garage? 👇\n\n#Cars #Automotive #Legends`
  ];
}

// --- 3. GET IMAGES (GOOGLE) ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  console.log("📸 Fetching images for:", carName);
  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: { q: `${carName} car press kit wallpaper 4k`, cx: CX_ID, key: GOOGLE_KEY, searchType: "image", num: 2 }
    });
    const paths = [];
    const items = res.data.items || [];
    
    for (let i = 0; i < items.length; i++) {
      try {
        const imgPath = path.join(__dirname, `temp_${i}.jpg`);
        const response = await axios({ url: items[i].link, method: "GET", responseType: "stream", timeout: 10000 });
        await new Promise((resolve, reject) => {
          const w = fs.createWriteStream(imgPath);
          response.data.pipe(w);
          w.on("finish", resolve);
          w.on("error", reject);
        });
        paths.push(imgPath);
      } catch (e) { console.error(`Failed to download image ${i}: ${e.message}`); }
    }
    return paths;
  } catch (e) { 
    console.error("Image Search Failed:", e.message);
    return []; 
  }
}

// --- MAIN RUNNER ---
async function run() {
  const history = loadHistory();
  
  // Select Topic
  let topic = await getWikiCar(history);
  if (!topic) topic = BACKUP_TOPICS[Math.floor(Math.random() * BACKUP_TOPICS.length)];
  console.log(`🏎️ Topic: ${topic}`);

  // Generate Content
  const tweets = await generateTweets(topic);
  const images = await getImages(topic);
  const sessionId = generateSessionId();

  try {
    console.log("✅ Starting Tweet process...");

    let prevId = null;
    for (let i = 0; i < tweets.length; i++) {
      let text = tweets[i];
      // Add invisible ID to last tweet to prevent duplicates
      if (i === 2) text += `\n\nRef: ${sessionId}`;

      // Upload Media (First tweet only)
      let mediaIds = [];
      if (i === 0 && images.length > 0) {
        for (const img of images) {
          try {
            console.log(`📤 Uploading image: ${img}`);
            const mediaId = await client.v1.uploadMedia(img);
            mediaIds.push(mediaId);
          } catch (e) {
            console.error(`⚠️ Image Upload Failed (Skipping Image): ${e.message}`);
          }
        }
        // Limit to 4 images per tweet
        mediaIds = mediaIds.slice(0, 4);
      }

      // Post Tweet
      const params = { text: text };
      if (mediaIds.length > 0) params.media = { media_ids: mediaIds };
      if (prevId) params.reply = { in_reply_to_tweet_id: prevId };

      console.log(`🐦 Posting Tweet ${i+1}...`);
      const resp = await client.v2.tweet(params);
      prevId = resp.data.id;
      console.log(`   Tweet Posted. ID: ${prevId}`);
    }

    saveHistory(topic);
    console.log("✅ Thread Complete.");

  } catch (error) {
    console.error("❌ Main Error Detailed:", JSON.stringify(error, null, 2));
    
    // DOOMSDAY PROTOCOL (Fallback)
    try {
      console.log("☢️ Attempting Doomsday Tweet...");
      const doom = DOOMSDAY_TWEETS[Math.floor(Math.random() * DOOMSDAY_TWEETS.length)] + `\n\nID: ${sessionId}`;
      await client.v2.tweet(doom);
      console.log("☢️ Doomsday Tweet Sent.");
    } catch (e) { 
        console.error("Critical Failure - Doomsday also failed:", e.message); 
    }
  }

  // Cleanup Images
  images.forEach(p => { 
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(e) {} 
  });
}

run();

