const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// --- CONFIGURATION ---
const MAX_LENGTH = 280;
const HISTORY_FILE = "posted_history.txt";

// --- EXPANDED WEB LIBRARY (MODERN FOCUSED + HYPERCARS) ---
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

// --- TOPICS: SPECIFIC MODELS (Preserve Generation/Year info) ---
const BACKUP_TOPICS = [
  // --- THE LEGENDS (Pre-1980s) ---
  "Lamborghini Miura", "Ferrari 250 GTO", "Mercedes-Benz 300 SL", 
  "Ford GT40", "Shelby Cobra 427", "Jaguar E-Type", "Aston Martin DB5",

  // --- 1980s ICONS ---
  "Ferrari F40", "Porsche 959", "Vector W8", "Audi Sport quattro S1", "Ferrari Testarossa", 
  "Lamborghini Countach", "BMW M1",
  
  // --- 1990s LEGENDS ---
  "McLaren F1", "Bugatti EB110", "Jaguar XJ220", "Mercedes-Benz CLK GTR", 
  "Porsche 911 GT1", "Nissan R390 GT1", "Dodge Viper GTS", "Toyota Supra (A80)", 
  "Honda NSX (first generation)", "Mazda RX-7", "Nissan Skyline GT-R (R34)", "Subaru Impreza 22B STi", 
  "Mitsubishi Lancer Evolution VI", "Ferrari F50", "Lamborghini Diablo", "Lotus Esprit V8",
  
  // --- 2000s SUPERSTARS ---
  "Ferrari Enzo", "Porsche Carrera GT", "Ford GT (2005)", "Mercedes-Benz SLR McLaren", 
  "Maserati MC12", "Pagani Zonda Cinque", "Bugatti Veyron", "Koenigsegg CCX", 
  "Saleen S7", "Lamborghini Murciélago LP 670-4 SuperVeloce", "Spyker C8", "Gumpert Apollo", 
  "Noble M600", "Aston Martin One-77", "Lexus LFA", "BMW M3 GTR",
  
  // --- MODERN HYPERCARS (2010s-Present) ---
  "McLaren P1", "Porsche 918 Spyder", "Ferrari LaFerrari", "Bugatti Chiron", 
  "Koenigsegg Jesko", "Pagani Huayra", "Aston Martin Valkyrie", "Mercedes-AMG One", 
  "Rimac Nevera", "Lotus Evija", "Hennessey Venom F5", "SSC Tuatara", 
  "McLaren Senna", "Ferrari FXX-K", "Aston Martin Vulcan", "Pagani Zonda R", 
  "Lamborghini Aventador SVJ", "Ferrari SF90 Stradale", "McLaren Speedtail", 
  "Gordon Murray Automotive T.50", "Zenvo TSR-S", "Koenigsegg Gemera", "Bugatti Bolide", 
  "Pininfarina Battista", "Lamborghini Revuelto", "Ferrari Daytona SP3"
];

const DOOMSDAY_TWEETS = [
  "Spotlight: Bugatti Chiron 🇫🇷\n\n1,500 HP quad-turbo W16 engine. A masterpiece of engineering that redefined speed.\n\nThe ultimate grand tourer. 🚀\n\n#Bugatti #Hypercar",
  "Spotlight: Koenigsegg Jesko 🇸🇪\n\nA 1,600 HP megacar capable of breaking the 300 mph barrier. Engineering without compromise.\n\nThe sound of the Light Speed Transmission is unreal. 🔊\n\n#Koenigsegg #Jesko",
  "Spotlight: Rimac Nevera 🇭🇷\n\nThe electric revolution. 0-60 in 1.85 seconds. A lightning storm on wheels.\n\nChanging the game forever. ⚡\n\n#Rimac #EV #Future"
];

// --- IMPROVED COLOR LIST (Safe for Classics & Modern) ---
const CAR_COLORS = [
  "Red", "Blue", "Black", "White", "Silver", "Grey"
];

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

// CRITICAL FIX: Do NOT strip brackets/years. Keep full specificity.
// Example: "Ford GT (2005)" stays "Ford GT (2005)" for strict searching.
function cleanTitle(title) {
  return title.trim(); 
}

// --- 1. WEB FETCH ---
async function getWikiCar(history) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      console.log(`🔎 Searching Wikipedia Category (Attempt ${attempt}/3): ${category}`);
      
      const url = "https://en.wikipedia.org/w/api.php";
      const res = await axios.get(url, {
        params: { 
          action: "query", list: "categorymembers", cmtitle: category, cmlimit: 100, format: "json", origin: "*" 
        },
        headers: { 'User-Agent': 'SuperCarBot/1.0' }
      });

      const members = res.data.query.categorymembers || [];
      const valid = members.filter(m => {
        const title = m.title; // Do not use cleanTitle yet
        return !title.startsWith("Category:") && 
               !title.includes("List of") && 
               !title.includes("User:") && 
               !title.includes("File:") &&
               !title.includes("Template:") &&
               !history.has(title);
      });

      if (valid.length > 0) {
        // Return the full, specific title (e.g., "Chevrolet Corvette (C8)")
        const chosen = valid[Math.floor(Math.random() * valid.length)].title;
        return chosen.trim();
      }
    } catch (e) { console.error("Wiki Fetch Failed:", e.message); }
  }
  return null;
}

// --- 2. GENERATE CONTENT (SINGLE POST) ---
async function generateSingleTweet(carName) {
  try {
    console.log(`🤖 Generating content for: ${carName}...`);
    
    // UPDATED PROMPT: Strict Single Tweet
    const prompt = `Write exactly ONE viral tweet (max 270 characters) about the car '${carName}'.
    
    Requirements:
    1. Start with the car name and a Hook.
    2. Include ONE key technical spec (Engine or HP or Top Speed).
    3. Include 3-4 hashtags at the end.
    
    Rules:
    - NO threading.
    - NO intro/outro text.
    - STRICTLY under 280 characters.
    - Use Emoji.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    let text = response.text.trim();
    // Remove any accidental quotes
    text = text.replace(/^"|"$/g, '');
    
    return text;

  } catch (e) {
    console.error("Gemini Failed:", e.message);
  }
  
  // Fallback Template
  console.log("⚠️ Using Fallback Template.");
  return `The ${carName} is an automotive masterpiece. 🏎️\n\nDefined by raw power and timeless design, it remains a legend of the road. 🏁\n\n#${carName.replace(/\s/g, '').replace(/[()]/g, '')} #Supercars #CarLegends`;
}

// --- 3. GET IMAGES (SAME CAR + IMPROVED SELECTION) ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  
  // Pick a "Safe" color for this session to ensure consistency across all angles
  const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  console.log(`📸 Fetching images for: ${carName} in ${color}`);
  
  const paths = [];
  const usedUrls = new Set(); 
  
  // Use QUOTES around carName to enforce EXACT model/generation match
  // Example query: "Ford GT (2005)" Red front view car 4k wallpaper
  const angleQueries = [
    { type: "front", query: `"${carName}" ${color} front view car 4k wallpaper` },
    { type: "rear",  query: `"${carName}" ${color} rear view car 4k wallpaper` },
    { type: "interior", query: `"${carName}" interior cockpit detail photo` }, 
    { type: "detail", query: `"${carName}" ${color} engine wheel detail close up` }
  ];

  // Exclude bad results
  const exclusions = "-site:pinterest.* -site:ebay.* -site:amazon.* -site:etsy.* -site:youtube.* -toy -model -diecast -scale -miniature -lego -hotwheels -r/c -drawing -sketch -render -3d -videogame -game -vector -cartoon -stock -alamy -auction";

  for (let i = 0; i < angleQueries.length; i++) {
    let fullQuery = `${angleQueries[i].query} ${exclusions}`;
    let items = await performSearch(fullQuery);
    
    if (items.length === 0) {
        console.log(`   ⚠️ No results for ${angleQueries[i].type}. Trying generic fallback...`);
        // Fallback: Less specific words, but keep quotes and color
        fullQuery = `"${carName}" ${color} real car photo ${exclusions}`;
        items = await performSearch(fullQuery);
    }

    if (items.length > 0) {
        let imgUrl = null;
        for (const item of items) {
            if (!usedUrls.has(item.link)) {
                imgUrl = item.link;
                usedUrls.add(imgUrl);
                break;
            }
        }

        if (imgUrl) {
            const imgPath = path.join(__dirname, `temp_${angleQueries[i].type}_${i}.jpg`);
            try {
                const response = await axios({ url: imgUrl, method: "GET", responseType: "stream", timeout: 10000 });
                await new Promise((resolve, reject) => {
                  const w = fs.createWriteStream(imgPath);
                  response.data.pipe(w);
                  w.on("finish", resolve);
                  w.on("error", reject);
                });
                paths.push(imgPath);
                console.log(`   ✅ Got ${angleQueries[i].type} image.`);
            } catch (e) {
                console.error(`   ❌ Download failed for ${imgUrl}`);
            }
        }
    }
  }
  return paths;
}

async function performSearch(query) {
    try {
        const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
            params: { 
              q: query, cx: CX_ID, key: GOOGLE_KEY, 
              searchType: "image", imgType: "photo", imgSize: "large", num: 8
            } 
        });
        return res.data.items || [];
    } catch (e) {
        console.error(`   ⚠️ Search API Error: ${e.message}`);
        return [];
    }
}

// --- MAIN RUNNER ---
async function run() {
  const history = loadHistory();
  
  let topic = await getWikiCar(history);
  if (!topic) {
    console.log("⚠️ Wiki search exhausted. Checking Backup list...");
    const availableBackups = BACKUP_TOPICS.filter(t => !history.has(t));
    topic = availableBackups.length > 0 ? 
            availableBackups[Math.floor(Math.random() * availableBackups.length)] : 
            BACKUP_TOPICS[Math.floor(Math.random() * BACKUP_TOPICS.length)];
  }
  
  console.log(`🏎️ Topic: ${topic}`);

  // Generate SINGLE text and fetch images
  let tweetText = await generateSingleTweet(topic);
  const images = await getImages(topic);
  const sessionId = generateSessionId();

  try {
    console.log(`✅ Starting Single Tweet process...`);

    // Ensure text is safe
    tweetText = safeTruncate(tweetText);

    let mediaIds = [];
    if (images.length > 0) {
      console.log(`📤 Uploading ${images.length} images...`);
      for (const img of images) {
        try {
          const mediaId = await client.v1.uploadMedia(img);
          mediaIds.push(mediaId);
        } catch (e) { console.error(`⚠️ Image Upload Failed: ${e.message}`); }
      }
      mediaIds = mediaIds.slice(0, 4);
    }

    const params = { text: tweetText };
    if (mediaIds.length > 0) params.media = { media_ids: mediaIds };

    console.log(`🐦 Posting Tweet...`);
    const resp = await client.v2.tweet(params);
    
    if (resp.data && resp.data.id) {
      console.log(`   Tweet Posted. ID: ${resp.data.id}`);
      saveHistory(topic);
    } else {
      throw new Error("API returned no Tweet ID");
    }

  } catch (error) {
    console.error("❌ Main Error Detailed:", JSON.stringify(error, null, 2));
    
    try {
        console.log("☢️ Attempting Doomsday Tweet...");
        const doom = DOOMSDAY_TWEETS[Math.floor(Math.random() * DOOMSDAY_TWEETS.length)] + `\n\nID: ${sessionId}`;
        await client.v2.tweet(doom);
    } catch (e) { console.error("Critical Failure:", e.message); }
  }

  // Cleanup Images
  images.forEach(p => { 
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(e) {} 
  });
}

run();

