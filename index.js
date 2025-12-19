const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// --- CONFIGURATION ---
const MAX_LENGTH = 280;
const HISTORY_FILE = "posted_history.txt";
const CAR_COLORS = ["Red", "Blue", "Black", "White", "Silver", "Grey", "Yellow", "Orange", "Green"];

const WIKI_CATEGORIES = [
  "Category:Hypercars", "Category:Grand_tourers", "Category:Homologation_specials", 
  "Category:V12_engine_automobiles", "Category:V10_engine_automobiles", 
  "Category:Bugatti_vehicles", "Category:Koenigsegg_vehicles", "Category:Pagani_vehicles", 
  "Category:McLaren_vehicles", "Category:Lamborghini_vehicles", "Category:Ferrari_vehicles"
];

// --- AUTHENTICATION ---
const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);
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

// --- 1. ROBUST WIKI FETCH ---
async function getWikiCar(history) {
  const genericTerms = ["luxury car", "concept car", "sports car", "supercar", "hypercar", "race car", "automobile", "vehicle", "car"];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      const res = await axios.get("https://en.wikipedia.org/w/api.php", {
        params: { action: "query", list: "categorymembers", cmtitle: category, cmlimit: 100, format: "json", origin: "*" },
        headers: { 'User-Agent': 'SuperCarBot/2.0' }
      });

      const members = res.data.query.categorymembers || [];
      const valid = members.filter(m => {
        const title = m.title.toLowerCase();
        return !title.startsWith("category:") && 
               !title.startsWith("file:") &&
               !title.includes("list of") && 
               !title.includes("talk:") &&
               !genericTerms.includes(title) &&
               title.split(" ").length >= 2 && // Avoid single words like "Ford"
               !history.has(m.title);
      });

      if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)].title.trim();
    } catch (e) { console.error("Wiki Fetch Failed:", e.message); }
  }
  return null;
}

// --- 2. ENHANCED TWEET GENERATION ---
async function generateSingleTweet(carName) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Write a high-energy, viral tweet about the '${carName}'. 
    Structure:
    - Exciting Hook with the car name.
    - One mind-blowing performance spec (0-60, Top Speed, or HP).
    - 3 relevant hashtags.
    Keep it under 270 characters. No quotes. Use 2-3 emojis.`;
    
    const result = await model.generateContent(prompt);
    return result.response.text().trim().replace(/^"|"$/g, '');
  } catch (e) {
    return `The ${carName} represents the pinnacle of automotive engineering. 🏎️🔥 #Supercars #Speed #${carName.replace(/\s/g, '')}`;
  }
}

// --- 3. KEYWORD-SCORED IMAGE FETCH ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  
  const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  const paths = [];
  const usedUrls = new Set(); 
  
  const angleQueries = [
    { type: "hero", query: `"${carName}" ${color} car photo high resolution` },
    { type: "detail", query: `"${carName}" wheel or interior dashboard detail` }
  ];

  const exclusions = "-site:pinterest.* -site:ebay.* -site:amazon.* -toy -model -diecast -scale -lego -r/c -drawing -sketch -render -3d -comparison -vs";

  for (let i = 0; i < angleQueries.length; i++) {
    let items = await performSearch(`${angleQueries[i].query} ${exclusions}`);
    
    // Scoring Logic: Title and snippet must contain significant car name components
    const nameKeywords = carName.toLowerCase().split(" ").filter(w => w.length > 2);
    
    const validItems = items.filter(item => {
      const metadata = (item.title + " " + (item.snippet || "")).toLowerCase();
      // Count how many keywords from the car name match the image metadata
      const matches = nameKeywords.filter(word => metadata.includes(word)).length;
      const score = matches / nameKeywords.length;
      return score >= 0.75; // Require 75% keyword match to be considered valid
    });

    if (validItems.length > 0) {
      for (const item of validItems) {
        if (!usedUrls.has(item.link)) {
          try {
            const imgPath = path.join(__dirname, `temp_${i}_${Date.now()}.jpg`);
            const response = await axios({ url: item.link, method: "GET", responseType: "stream", timeout: 8000 });
            await new Promise((resolve, reject) => {
              const w = fs.createWriteStream(imgPath);
              response.data.pipe(w);
              w.on("finish", resolve);
              w.on("error", reject);
            });
            paths.push(imgPath);
            usedUrls.add(item.link);
            break; 
          } catch (e) { console.error(`Download failed: ${item.link}`); }
        }
      }
    }
  }
  return paths;
}

async function performSearch(query) {
  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: { q: query, cx: CX_ID, key: GOOGLE_KEY, searchType: "image", imgSize: "xlarge", num: 10 } 
    });
    return res.data.items || [];
  } catch (e) { return []; }
}

// --- MAIN RUNNER ---
async function run() {
  const history = loadHistory();
  let topic = await getWikiCar(history);
  
  if (!topic) {
    console.log("⚠️ No new Wiki car found. Using backup...");
    const backups = ["Ferrari F40", "McLaren P1", "Lamborghini Aventador", "Bugatti Chiron"];
    topic = backups[Math.floor(Math.random() * backups.length)];
  }
  
  console.log(`🏎️ Processing: ${topic}`);

  const tweetText = await generateSingleTweet(topic);
  const images = await getImages(topic);

  try {
    let mediaIds = [];
    for (const img of images) {
      try {
        const mediaId = await client.v1.uploadMedia(img);
        mediaIds.push(mediaId);
      } catch (e) { console.error("Upload failed for one image."); }
    }

    const params = { text: tweetText.substring(0, MAX_LENGTH) };
    if (mediaIds.length > 0) params.media = { media_ids: mediaIds.slice(0, 4) };

    const resp = await client.v2.tweet(params);
    if (resp.data) {
      console.log(`🚀 Successfully Posted! Tweet ID: ${resp.data.id}`);
      saveHistory(topic);
    }
  } catch (error) {
    console.error("Critical Post Error:", error.message);
  }

  // Cleanup local files
  images.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
}

run();

