const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// --- CONFIGURATION ---
const MAX_LENGTH = 280;
const HISTORY_FILE = "posted_history.txt";

// --- EXPANDED WEB LIBRARY ---
const WIKI_CATEGORIES = [
  "Category:Supercars", "Category:Hypercars", "Category:Sports_cars", 
  "Category:Grand_tourers", "Category:Muscle_cars", "Category:Rally_cars",
  "Category:Homologation_specials", "Category:Concept_cars", 
  "Category:Rear_mid-engine,_rear-wheel-drive_vehicles",
  "Category:Luxury_vehicles", "Category:V12_engine_automobiles", 
  "Category:V10_engine_automobiles", "Category:W16_engine_automobiles",
  "Category:Ferrari_vehicles", "Category:Lamborghini_vehicles", 
  "Category:Porsche_vehicles", "Category:McLaren_vehicles", 
  "Category:Bugatti_vehicles", "Category:Aston_Martin_vehicles",
  "Category:Maserati_vehicles", "Category:Pagani_vehicles",
  "Category:Koenigsegg_vehicles", "Category:Lotus_vehicles",
  "Category:Alfa_Romeo_vehicles", "Category:BMW_M_vehicles",
  "Category:Mercedes-AMG_vehicles", "Category:Audi_Sport_vehicles"
];

const BACKUP_TOPICS = [
  "McLaren P1", "Porsche 918 Spyder", "Ferrari LaFerrari",
  "McLaren F1", "Ferrari F40", "Porsche 959", "Bugatti EB110", "Jaguar XJ220", 
  "Mercedes-Benz CLK GTR", "Porsche 911 GT1", "Nissan R390 GT1", "Dodge Viper GTS",
  "Bugatti Chiron", "Koenigsegg Jesko", "Pagani Huayra", "Aston Martin Valkyrie", 
  "Mercedes-AMG One", "Rimac Nevera", "Lotus Evija", "Hennessey Venom F5", "SSC Tuatara", 
  "Nissan Skyline GT-R R34", "Mazda 787B", "Toyota Supra MK4", "Honda NSX-R", 
  "Lexus LFA", "Subaru Impreza 22B", "Mitsubishi Lancer Evolution VI", "Mazda RX-7 FD",
  "Lamborghini Countach", "Lamborghini Miura", "Ferrari Enzo", "Ferrari F50", 
  "Pagani Zonda Cinque", "Lamborghini Diablo GT", "Alfa Romeo 33 Stradale", 
  "Lancia Stratos", "Maserati MC12", "Ferrari 250 GTO", "Lamborghini Murciélago SV",
  "Porsche Carrera GT", "Mercedes-Benz 300SL Gullwing", "BMW M1", "Audi Quattro S1", 
  "BMW E46 M3 GTR", "Porsche 917K", "Mercedes-Benz SLR McLaren", "Audi R8 V10 Plus",
  "Ford GT40", "Shelby Cobra 427", "Dodge Viper ACR", "Chevrolet Corvette C8 Z06", 
  "Saleen S7", "Ford GT (2005)", "Vector W8", "Shelby Mustang GT500", "Plymouth Superbird",
  "McLaren Senna", "Ferrari FXX-K", "Aston Martin Vulcan", "Pagani Zonda R"
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

function cleanTitle(title) {
  return title.replace(/ \(.+\)$/, "").trim();
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
        const title = cleanTitle(m.title);
        return !m.title.startsWith("Category:") && 
               !m.title.includes("List of") && 
               !m.title.includes("User:") && 
               !m.title.includes("File:") &&
               !m.title.includes("Template:") &&
               !history.has(title);
      });

      if (valid.length > 0) {
        const chosen = valid[Math.floor(Math.random() * valid.length)].title;
        return cleanTitle(chosen);
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
  
  // Fallback Template (Single Tweet)
  console.log("⚠️ Using Fallback Template.");
  return `The ${carName} is an automotive masterpiece. 🏎️\n\nDefined by raw power and timeless design, it remains a legend of the road. 🏁\n\n#${carName.replace(/\s/g, '')} #Supercars #CarLegends`;
}

// --- 3. GET IMAGES (SAME CAR/MODEL STRICT) ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  console.log("📸 Fetching specific angle images for:", carName);
  
  const paths = [];
  const usedUrls = new Set(); 
  
  // Strict quoted queries to ensure exact model match
  const angleQueries = [
    { type: "front", query: `"${carName}" front view real car photo hd` },
    { type: "rear",  query: `"${carName}" rear view real car photo hd` },
    { type: "interior", query: `"${carName}" interior cockpit photo hd` },
    { type: "detail", query: `"${carName}" engine wheel detail photo` }
  ];

  // Exclude toys, models, and bad sites
  const exclusions = "-site:pinterest.* -site:ebay.* -site:amazon.* -site:etsy.* -site:youtube.* -toy -model -diecast -scale -miniature -lego -hotwheels -r/c -drawing -sketch -render -3d -videogame -game -vector -cartoon -stock -alamy";

  for (let i = 0; i < angleQueries.length; i++) {
    let fullQuery = `${angleQueries[i].query} ${exclusions}`;
    let items = await performSearch(fullQuery);
    
    if (items.length === 0) {
        console.log(`   ⚠️ No results for ${angleQueries[i].type}. Trying generic fallback...`);
        // Fallback still uses quoted name for consistency
        fullQuery = `"${carName}" real car photo ${exclusions}`;
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
    
    // Doomsday Tweet (Single Post)
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

