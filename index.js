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

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function safeTruncate(text) {
  if (text.length <= MAX_LENGTH) return text;
  return text.substring(0, MAX_LENGTH - 3) + "...";
}

function cleanTitle(title) {
  return title.replace(/ \(.+\)$/, "").trim();
}

// --- 1. WEB FETCH (RETRY MODE) ---
async function getWikiCar(history) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      console.log(`🔎 Searching Wikipedia Category (Attempt ${attempt}/3): ${category}`);
      
      const url = "https://en.wikipedia.org/w/api.php";
      const res = await axios.get(url, {
        params: { 
          action: "query", list: "categorymembers", cmtitle: category, cmlimit: 100, format: "json", origin: "*" 
        }
      });

      const members = res.data.query.categorymembers || [];
      const valid = members.filter(m => {
        const title = cleanTitle(m.title);
        return !m.title.startsWith("Category:") && !m.title.startsWith("List of") && 
               !m.title.startsWith("User:") && !m.title.startsWith("File:") &&
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

// --- 2. GENERATE CONTENT (FLEXIBLE 2-3 TWEETS) ---
async function generateTweets(carName) {
  try {
    console.log(`🤖 Generating content for: ${carName}...`);
    
    const prompt = `Write a viral Twitter thread (2 or 3 tweets total) about the '${carName}'.
    
    Structure:
    Tweet 1: A captivating Hook/Intro. Why is this car legendary?
    Tweet 2: Technical Specs (Bullet points) or Cool Facts.
    Tweet 3 (Optional): Legacy & Conclusion. If 2 tweets are enough, combine with Tweet 2.
    
    Ends with 5-8 VIRAL HASHTAGS in the final tweet.

    Rules:
    - Separate tweets strictly with '|||'.
    - Use Emoji.
    - Max 260 characters per tweet.
    - No markdown bolding.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    const text = response.text;
    const parts = text.split('|||').map(p => p.trim());
    
    if (parts.length >= 2 && parts.length <= 3) return parts;
  } catch (e) {
    console.error("Gemini Failed:", e.message);
  }
  
  // Fallback
  console.log("⚠️ Using Fallback Template.");
  return [
    `Legendary Machine: ${carName} 🏎️\n\nA masterclass in automotive engineering. This machine dominates the road.\n\n(Thread 🧵) #Cars`,
    `The ${carName} is defined by its incredible performance and soul-stirring sound. 🏁\n\n• Engine: Masterpiece\n• Speed: Fast\n• Design: Timeless`,
    `Is the ${carName} in your dream garage? 👇\n\n#${carName.replace(/\s/g, '')} #Supercars #Automotive #DreamCar #Legends`
  ];
}

// --- 3. GET IMAGES (STRICT REAL + NO SALES) ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  console.log("📸 Fetching images for:", carName);
  
  // Updated Query: 
  // 1. Enforces "real life"
  // 2. Removes Games/AI (-game, -ai)
  // 3. Removes Sales/Ads (-sale, -price, -dealer, -auction)
  const safeQuery = `"${carName}" real life car photo -game -videogame -assetto -forza -nfs -gta -gran -turismo -screenshot -ai -midjourney -dalle -render -conceptart -sale -buy -price -auction -dealer -ebay -craigslist`;

  try {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: { q: safeQuery, cx: CX_ID, key: GOOGLE_KEY, searchType: "image", num: 2 }
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
  
  let topic = await getWikiCar(history);
  if (!topic) {
    console.log("⚠️ Wiki search exhausted. Checking Backup list...");
    const availableBackups = BACKUP_TOPICS.filter(t => !history.has(t));
    topic = availableBackups.length > 0 ? 
            availableBackups[Math.floor(Math.random() * availableBackups.length)] : 
            BACKUP_TOPICS[Math.floor(Math.random() * BACKUP_TOPICS.length)];
  }
  
  console.log(`🏎️ Topic: ${topic}`);

  const tweets = await generateTweets(topic);
  const images = await getImages(topic);
  const sessionId = generateSessionId();

  try {
    console.log(`✅ Starting Tweet process (${tweets.length} tweets)...`);

    let prevId = null;
    for (let i = 0; i < tweets.length; i++) {
      let text = tweets[i];
      
      if (i === tweets.length - 1) text += `\n\nRef: ${sessionId}`;
      text = safeTruncate(text);

      let mediaIds = [];
      if (i === 0 && images.length > 0) {
        for (const img of images) {
          try {
            console.log(`📤 Uploading image: ${img}`);
            const mediaId = await client.v1.uploadMedia(img);
            mediaIds.push(mediaId);
          } catch (e) { console.error(`⚠️ Image Upload Failed: ${e.message}`); }
        }
        mediaIds = mediaIds.slice(0, 4);
      }

      const params = { text: text };
      if (mediaIds.length > 0) params.media = { media_ids: mediaIds };
      if (prevId) {
        params.reply = { in_reply_to_tweet_id: prevId };
        console.log(`🔗 Linking to thread parent: ${prevId}`);
      }

      console.log(`🐦 Posting Tweet ${i+1}/${tweets.length}...`);
      const resp = await client.v2.tweet(params);
      prevId = resp.data.id;
      console.log(`   Tweet Posted. ID: ${prevId}`);

      if (i < tweets.length - 1) {
        console.log("⏳ Waiting 3s for thread propagation...");
        await wait(3000); 
      }
    }

    saveHistory(topic);
    console.log("✅ Thread Complete.");

  } catch (error) {
    console.error("❌ Main Error Detailed:", JSON.stringify(error, null, 2));
    
    try {
      console.log("☢️ Attempting Doomsday Tweet...");
      const doom = DOOMSDAY_TWEETS[Math.floor(Math.random() * DOOMSDAY_TWEETS.length)] + `\n\nID: ${sessionId}`;
      await client.v2.tweet(doom);
    } catch (e) { console.error("Critical Failure:", e.message); }
  }

  images.forEach(p => { 
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(e) {} 
  });
}

run();
