const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// --- CONFIGURATION ---
const HISTORY_FILE = "posted_history.txt";

// Expanded list of specific models to ensure high-quality matches
const WIKI_CATEGORIES = [
  "Category:Hypercars", "Category:Grand_tourers", "Category:Homologation_specials", 
  "Category:Bugatti_vehicles", "Category:Koenigsegg_vehicles", "Category:Pagani_vehicles", 
  "Category:McLaren_vehicles", "Category:Lamborghini_vehicles", "Category:Ferrari_vehicles",
  "Category:Porsche_vehicles", "Category:Aston_Martin_vehicles", "Category:Maserati_vehicles"
];

// --- AUTHENTICATION ---
const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

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

// --- 1. TOPIC SELECTION ---
async function getWikiCar(history) {
  const genericTerms = ["luxury car", "concept car", "sports car", "supercar", "hypercar", "race car", "automobile", "vehicle", "car", "railcar", "limousine"];

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      const res = await axios.get("https://en.wikipedia.org/w/api.php", {
        params: { action: "query", list: "categorymembers", cmtitle: category, cmlimit: 100, format: "json", origin: "*" },
        headers: { 'User-Agent': 'SuperCarBot/7.0' }
      });

      const members = res.data.query.categorymembers || [];
      const valid = members.filter(m => {
        const title = m.title.toLowerCase();
        return !title.startsWith("category:") && 
               !title.includes("list of") && 
               !title.includes("template:") && 
               !genericTerms.includes(title) && 
               !history.has(m.title);
      });

      if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)].title.trim();
    } catch (e) { console.error("Wiki Fetch Failed:", e.message); }
  }
  return null;
}

// --- 2. GET CONSISTENT GALLERY (SAME PHOTOSHOOT) ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  
  // TRUSTED SITES: These host "Galleries" where all photos are from the same press shoot.
  // Searching specifically here ensures visual consistency (same color/lighting).
  const TRUSTED_SOURCES = [
    { name: "NetCarShow", query: `site:netcarshow.com "${carName}"` },
    { name: "Caricos", query: `site:caricos.com "${carName}"` },
    { name: "WSupercars", query: `site:wsupercars.com "${carName}"` },
    { name: "FavCars", query: `site:favcars.com "${carName}"` }
  ];

  const paths = [];
  const usedUrls = new Set(); 
  
  // We need a browser-like User-Agent because some of these sites block bot requests
  const axiosConfig = {
    responseType: "stream",
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  };

  // 1. Try sources sequentially. If one gives us 4 good images, STOP.
  // This guarantees the images are likely from the same set/source.
  for (const source of TRUSTED_SOURCES) {
    console.log(`🔎 Searching source: ${source.name} for ${carName}...`);
    
    try {
      const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
        params: { 
          q: source.query, 
          cx: CX_ID, 
          key: GOOGLE_KEY, 
          searchType: "image", 
          imgSize: "xlarge",  // Only high-res
          num: 10             // Fetch batch
        } 
      });
      
      const items = res.data.items || [];
      const nameKeywords = carName.toLowerCase().split(" ").filter(w => w.length > 2);

      // STRICT Validation: Car name MUST be in the title
      const validItems = items.filter(item => {
        const text = (item.title + " " + (item.snippet || "")).toLowerCase();
        // Check if all major parts of the car name are present
        return nameKeywords.every(w => text.includes(w));
      });

      if (validItems.length >= 4) {
        console.log(`   ✅ Found consistent set on ${source.name}`);
        
        // Download up to 4 images from this SINGLE source
        for (const item of validItems) {
          if (paths.length >= 4) break;
          
          if (!usedUrls.has(item.link)) {
            try {
              const imgPath = path.join(__dirname, `temp_${paths.length}_${Date.now()}.jpg`);
              const response = await axios({ url: item.link, method: "GET", ...axiosConfig });
              
              await new Promise((res, rej) => {
                const w = fs.createWriteStream(imgPath);
                response.data.pipe(w);
                w.on("finish", res);
                w.on("error", rej);
              });
              
              paths.push(imgPath);
              usedUrls.add(item.link);
            } catch(e) { 
              // console.error("   Image download skipped (likely anti-bot protection)"); 
            }
          }
        }
      }

      // If we successfully got 4 images from this source, we are done.
      // This ensures "Same Photoshoot" consistency.
      if (paths.length >= 4) break;

    } catch (e) { console.error(`   Search Error on ${source.name}`); }
  }
  
  // Fallback: If trusted sites failed to give 4, try a general highly specific search
  if (paths.length < 4) {
    console.log("⚠️ Trusted sources yielded insufficient images. Trying fallback...");
    // ... (You could add a fallback here, but it's safer to skip posting than post wrong cars)
  }

  return paths;
}

// --- MAIN RUNNER ---
async function run() {
  const history = loadHistory();
  const topic = await getWikiCar(history);
  
  if (!topic) return console.log("No new topics found.");

  console.log(`🏎️ Target: ${topic}`);
  const images = await getImages(topic);

  if (images.length < 2) {
    console.log("❌ Not enough consistent images found. Skipping post to avoid errors.");
    // Cleanup any partials
    images.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
    return;
  }

  try {
    let mediaIds = [];
    console.log(`📤 Uploading ${images.length} photos...`);
    
    for (const img of images) {
      try {
        const mediaId = await client.v1.uploadMedia(img);
        mediaIds.push(mediaId);
      } catch (e) { console.error("Media Upload Error"); }
    }

    if (mediaIds.length > 0) {
      // POST: Just the Car Name + Photos
      const resp = await client.v2.tweet({
        text: topic, 
        media: { media_ids: mediaIds.slice(0, 4) }
      });
      
      console.log(`🚀 Posted: ${topic} (ID: ${resp.data.id})`);
      saveHistory(topic);
    }
  } catch (error) { console.error("Critical Post Error:", error.message); }

  // Cleanup
  images.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
}

run();

