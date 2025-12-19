const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// --- CONFIGURATION ---
const MAX_LENGTH = 280;
const HISTORY_FILE = "posted_history.txt";

const WIKI_CATEGORIES = [
  "Category:Hypercars", "Category:Grand_tourers", "Category:Homologation_specials", 
  "Category:Concept_cars", "Category:V12_engine_automobiles", "Category:V10_engine_automobiles", 
  "Category:W16_engine_automobiles", "Category:Bugatti_vehicles", "Category:Koenigsegg_vehicles", 
  "Category:Pagani_vehicles", "Category:McLaren_vehicles", "Category:Lamborghini_vehicles", 
  "Category:Ferrari_vehicles", "Category:Aston_Martin_vehicles", "Category:Maserati_vehicles", 
  "Category:Lotus_vehicles", "Category:Rimac_vehicles", "Category:Hennessey_vehicles",
  "Category:Zenvo_vehicles", "Category:Spyker_vehicles", "Category:Gumpert_vehicles",
  "Category:Noble_vehicles", "Category:SSC_North_America_vehicles"
];

const BACKUP_TOPICS = [
  "Lamborghini Miura", "Ferrari 250 GTO", "Mercedes-Benz 300 SL", "Ford GT40", 
  "Ferrari F40", "Porsche 959", "McLaren F1", "Bugatti EB110", "Ferrari Enzo", 
  "Porsche Carrera GT", "McLaren P1", "Porsche 918 Spyder", "Ferrari LaFerrari", 
  "Bugatti Chiron", "Koenigsegg Jesko", "Rimac Nevera"
];

const DOOMSDAY_TWEETS = [
  "Spotlight: Bugatti Chiron 🇫🇷\n\n1,500 HP quad-turbo W16 engine. A masterpiece of engineering. #Bugatti #Hypercar",
  "Spotlight: Koenigsegg Jesko 🇸🇪\n\nEngineering without compromise. 300+ mph potential. #Koenigsegg #Jesko",
  "Spotlight: Rimac Nevera 🇭🇷\n\n0-60 in 1.85 seconds. The electric revolution. #Rimac #EV #Future"
];

const CAR_COLORS = ["Red", "Blue", "Black", "White", "Silver", "Grey"];

// --- AUTHENTICATION ---
const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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

function safeTruncate(text) {
  if (text.length <= MAX_LENGTH) return text;
  return text.substring(0, MAX_LENGTH - 3) + "...";
}

// --- 1. WEB FETCH (IMPROVED) ---
async function getWikiCar(history) {
  // Generic terms to ignore (prevents broad searches like "Luxury car")
  const genericTerms = ["luxury car", "concept car", "sports car", "supercar", "hypercar", "race car", "automobile"];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      console.log(`🔎 Searching Wiki Category: ${category}`);
      
      const res = await axios.get("https://en.wikipedia.org/w/api.php", {
        params: { action: "query", list: "categorymembers", cmtitle: category, cmlimit: 100, format: "json", origin: "*" },
        headers: { 'User-Agent': 'SuperCarBot/1.0' }
      });

      const members = res.data.query.categorymembers || [];
      const valid = members.filter(m => {
        const title = m.title.toLowerCase();
        return !title.startsWith("category:") && 
               !title.includes("list of") && 
               !genericTerms.includes(title) && // Filter out generic entries
               !history.has(m.title);
      });

      if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)].title.trim();
    } catch (e) { console.error("Wiki Fetch Failed:", e.message); }
  }
  return null;
}

// --- 2. GENERATE CONTENT ---
async function generateSingleTweet(carName) {
  try {
    const prompt = `Write exactly ONE viral tweet (max 270 characters) about the car '${carName}'.
    Requirements:
    1. Start with the car name and a Hook.
    2. Include ONE key technical spec (Engine or HP or Top Speed).
    3. Include 3-4 hashtags at the end.
    Rules: NO threading, NO intro/outro, STRICTLY under 280 characters. Use Emoji.`;

    const response = await ai.getGenerativeModel({ model: "gemini-1.5-flash" }).generateContent(prompt);
    let text = response.response.text().trim().replace(/^"|"$/g, '');
    return text;
  } catch (e) {
    console.error("Gemini Failed:", e.message);
    return `The ${carName} is an automotive masterpiece. 🏎️\n\nDefined by raw power and timeless design. 🏁\n\n#${carName.replace(/\s/g, '').replace(/[()]/g, '')} #Supercars`;
  }
}

// --- 3. GET IMAGES (FIXED SELECTION) ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  
  const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  const paths = [];
  const usedUrls = new Set(); 
  
  const angleQueries = [
    { type: "front", query: `"${carName}" ${color} front view car 4k wallpaper` },
    { type: "rear",  query: `"${carName}" ${color} rear view car 4k wallpaper` },
    { type: "interior", query: `"${carName}" interior cockpit detail photo` }
  ];

  const exclusions = "-site:pinterest.* -site:ebay.* -site:amazon.* -toy -model -diecast -lego -r/c -drawing -sketch -render -3d -stock -alamy";

  for (let i = 0; i < angleQueries.length; i++) {
    let items = await performSearch(`${angleQueries[i].query} ${exclusions}`);
    
    // VALIDATION: Filter results to ensure they mention the car name in title/snippet
    const validItems = items.filter(item => {
      const metadata = (item.title + " " + (item.snippet || "")).toLowerCase();
      const nameWords = carName.toLowerCase().split(" ").filter(w => w.length > 2);
      // Ensure all major keywords of the car name appear in the search result metadata
      return nameWords.every(word => metadata.includes(word));
    });

    const targetList = validItems.length > 0 ? validItems : items;

    for (const item of targetList) {
      if (!usedUrls.has(item.link)) {
        try {
          const imgPath = path.join(__dirname, `temp_${i}.jpg`);
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
        } catch (e) { console.error(`Download error for ${item.link}`); }
      }
    }
  }
  return paths;
}

async function performSearch(query) {
  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: { q: query, cx: CX_ID, key: GOOGLE_KEY, searchType: "image", imgSize: "large", num: 10 } 
    });
    return res.data.items || [];
  } catch (e) { return []; }
}

// --- MAIN RUNNER ---
async function run() {
  const history = loadHistory();
  let topic = await getWikiCar(history);
  if (!topic) topic = BACKUP_TOPICS[Math.floor(Math.random() * BACKUP_TOPICS.length)];
  
  console.log(`🏎️ Final Topic: ${topic}`);

  let tweetText = safeTruncate(await generateSingleTweet(topic));
  const images = await getImages(topic);

  try {
    let mediaIds = [];
    for (const img of images) {
      try {
        const mediaId = await client.v1.uploadMedia(img);
        mediaIds.push(mediaId);
      } catch (e) { console.error("Upload failed"); }
    }

    const params = { text: tweetText };
    if (mediaIds.length > 0) params.media = { media_ids: mediaIds.slice(0, 4) };

    const resp = await client.v2.tweet(params);
    if (resp.data) saveHistory(topic);

  } catch (error) {
    console.error("Post failed, sending fallback...");
    const doom = DOOMSDAY_TWEETS[Math.floor(Math.random() * DOOMSDAY_TWEETS.length)];
    await client.v2.tweet(doom);
  }

  images.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
}

run();

