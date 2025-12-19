const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// --- CONFIGURATION ---
const MAX_LENGTH = 280;
const HISTORY_FILE = "posted_history.txt";
const CAR_COLORS = ["Red", "Blue", "Black", "White", "Silver", "Grey", "Yellow", "Orange", "Green", "Gold"];

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

function safeTruncate(text) {
  if (text.length <= MAX_LENGTH) return text;
  return text.substring(0, MAX_LENGTH - 3) + "...";
}

// --- 1. TARGETED WIKI FETCH ---
async function getWikiCar(history) {
  const genericTerms = ["luxury car", "concept car", "sports car", "supercar", "hypercar", "race car", "automobile", "vehicle", "car", "railcar"];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      const res = await axios.get("https://en.wikipedia.org/w/api.php", {
        params: { action: "query", list: "categorymembers", cmtitle: category, cmlimit: 100, format: "json", origin: "*" },
        headers: { 'User-Agent': 'SuperCarBot/2.5' }
      });

      const members = res.data.query.categorymembers || [];
      const valid = members.filter(m => {
        const title = m.title.toLowerCase();
        return !title.startsWith("category:") && 
               !title.startsWith("file:") &&
               !title.includes("list of") && 
               !title.includes("talk:") &&
               !genericTerms.includes(title) &&
               title.split(" ").length >= 2 && 
               !history.has(m.title);
      });

      if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)].title.trim();
    } catch (e) { console.error("Wiki Fetch Failed:", e.message); }
  }
  return null;
}

// --- 2. DEEP DETAIL THREAD GENERATION ---
async function generateCarThread(carName) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Write a highly detailed 3-tweet thread about the '${carName}'. 
    Use the full 280-character limit for each tweet to provide deep technical insights.

    Structure:
    Tweet 1: The Hook and Heart. Mention the car name, engine configuration (V8, V12, W16), displacement, aspiration (Twin-Turbo, N/A), and exact Horsepower/Torque figures.
    Tweet 2: The Performance Dynamics. Detail the 0-60 mph (or 0-100 km/h) time, top speed, gearbox type (dual-clutch, manual), and aerodynamic features (active wings, downforce kg).
    Tweet 3: The Legacy and Rarity. Discuss production numbers, chassis materials (Carbon Fiber, Monocoque), current market value/significance, and 4-5 hashtags.

    Rules: 
    - Each tweet MUST be close to 270-280 characters.
    - No introductory text or quotes.
    - Use technical automotive language.
    - Return ONLY a JSON array of strings: ["tweet 1 content", "tweet 2 content", "tweet 3 content"]`;
    
    const result = await model.generateContent(prompt);
    const content = result.response.text().trim().replace(/```json|```/g, "");
    return JSON.parse(content);
  } catch (e) {
    console.error("Gemini Thread Generation Failed:", e.message);
    return [
      `The ${carName} is an engineering masterpiece. Powered by a high-performance engine, it delivers massive horsepower and torque, setting it apart as a true titan of the road. 🏎️🔥`,
      `With a 0-60 time that defies physics and a top speed reaching into the stratosphere, its aerodynamics and precision-tuned gearbox ensure every ounce of power is utilized. 💨`,
      `Produced in limited numbers and utilizing cutting-edge carbon fiber construction, it remains a coveted icon for collectors worldwide. #Supercars #Hypercars #Speed #${carName.replace(/\s/g, '')}`
    ];
  }
}

// --- 3. VERIFIED IMAGE FETCH ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  const paths = [];
  const usedUrls = new Set(); 
  
  const angleQueries = [
    { type: "hero", query: `intitle:"${carName}" ${color} car front 4k wallpaper` },
    { type: "rear",  query: `intitle:"${carName}" ${color} car rear view 4k` },
    { type: "interior", query: `intitle:"${carName}" car cockpit steering wheel` }
  ];

  const exclusions = "-site:pinterest.* -site:ebay.* -site:amazon.* -toy -model -diecast -scale -lego -r/c -drawing -sketch -render -3d -comparison -vs";

  for (let i = 0; i < angleQueries.length; i++) {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: { q: `${angleQueries[i].query} ${exclusions}`, cx: CX_ID, key: GOOGLE_KEY, searchType: "image", imgSize: "xlarge", num: 10 } 
    });
    const items = res.data.items || [];
    
    const nameKeywords = carName.toLowerCase().split(" ").filter(w => w.length > 2);
    const validItems = items.filter(item => {
      const metadata = (item.title + " " + (item.snippet || "")).toLowerCase();
      const matches = nameKeywords.filter(word => metadata.includes(word)).length;
      return (matches / nameKeywords.length) >= 0.75; 
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
          } catch (e) { console.error(`Download error for ${item.link}`); }
        }
      }
    }
  }
  return paths;
}

// --- MAIN RUNNER ---
async function run() {
  const history = loadHistory();
  let topic = await getWikiCar(history);
  if (!topic) topic = "McLaren P1"; 
  
  console.log(`🏎️ Final Topic: ${topic}`);

  const threadTexts = await generateCarThread(topic);
  const images = await getImages(topic);

  try {
    let mediaIds = [];
    for (const img of images) {
      try {
        const mediaId = await client.v1.uploadMedia(img);
        mediaIds.push(mediaId);
      } catch (e) { console.error("Upload failed"); }
    }

    const threadItems = threadTexts.map((text, index) => {
      const item = { text: safeTruncate(text) };
      // Distribute images across the thread (one per tweet)
      if (mediaIds[index]) item.media = { media_ids: [mediaIds[index]] };
      return item;
    });

    const resp = await client.v2.tweetThread(threadItems);
    if (resp.length > 0) {
      console.log(`🚀 Deep Detail Thread Posted! ID: ${resp[0].data.id}`);
      saveHistory(topic);
    }
  } catch (error) {
    console.error("Thread post failed:", error.message);
  }

  images.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
}

run();

