const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// --- CONFIGURATION ---
const MAX_LENGTH = 280;
const HISTORY_FILE = "posted_history.txt";

// --- EXPANDED WEB LIBRARY (40+ Categories) ---
const WIKI_CATEGORIES = [
  // Performance
  "Category:Supercars", "Category:Hypercars", "Category:Sports_cars", 
  "Category:Grand_tourers", "Category:Muscle_cars", "Category:Rally_cars",
  "Category:Homologation_specials", "Category:Concept_cars", 
  "Category:Rear_mid-engine,_rear-wheel-drive_vehicles",
  
  // Luxury & Engineering
  "Category:Luxury_vehicles", "Category:V12_engine_automobiles", 
  "Category:V10_engine_automobiles", "Category:W16_engine_automobiles",

  // Specific Brands (High Probability of Good Cars)
  "Category:Ferrari_vehicles", "Category:Lamborghini_vehicles", 
  "Category:Porsche_vehicles", "Category:McLaren_vehicles", 
  "Category:Bugatti_vehicles", "Category:Aston_Martin_vehicles",
  "Category:Maserati_vehicles", "Category:Pagani_vehicles",
  "Category:Koenigsegg_vehicles", "Category:Lotus_vehicles",
  "Category:Alfa_Romeo_vehicles", "Category:BMW_M_vehicles",
  "Category:Mercedes-AMG_vehicles", "Category:Audi_Sport_vehicles"
];

// --- MASSIVE BACKUP LIST (100+ Icons) ---
const BACKUP_TOPICS = [
  // Holy Trinity
  "McLaren P1", "Porsche 918 Spyder", "Ferrari LaFerrari",
  // 90s Icons
  "McLaren F1", "Ferrari F40", "Porsche 959", "Bugatti EB110", "Jaguar XJ220", 
  "Mercedes-Benz CLK GTR", "Porsche 911 GT1", "Nissan R390 GT1", "Dodge Viper GTS",
  // Hypercars
  "Bugatti Chiron", "Koenigsegg Jesko", "Pagani Huayra", "Aston Martin Valkyrie", 
  "Mercedes-AMG One", "Rimac Nevera", "Lotus Evija", "Hennessey Venom F5", "SSC Tuatara", 
  "Zenvo ST1", "Devel Sixteen", "Pininfarina Battista", "Gordon Murray T.50",
  // JDM Legends
  "Nissan Skyline GT-R R34", "Mazda 787B", "Toyota Supra MK4", "Honda NSX-R", 
  "Lexus LFA", "Subaru Impreza 22B", "Mitsubishi Lancer Evolution VI", "Mazda RX-7 FD",
  "Nissan Silvia S15", "Toyota 2000GT", "Datsun 240Z",
  // Italian Masterpieces
  "Lamborghini Countach", "Lamborghini Miura", "Ferrari Enzo", "Ferrari F50", 
  "Pagani Zonda Cinque", "Lamborghini Diablo GT", "Alfa Romeo 33 Stradale", 
  "Lancia Stratos", "Maserati MC12", "Ferrari 250 GTO", "Lamborghini Murciélago SV",
  // German Precision
  "Porsche Carrera GT", "Mercedes-Benz 300SL Gullwing", "BMW M1", "Audi Quattro S1", 
  "BMW E46 M3 GTR", "Porsche 917K", "Mercedes-Benz SLR McLaren", "Audi R8 V10 Plus",
  "Porsche 911 GT3 RS", "BMW 507",
  // American Muscle & Speed
  "Ford GT40", "Shelby Cobra 427", "Dodge Viper ACR", "Chevrolet Corvette C8 Z06", 
  "Saleen S7", "Ford GT (2005)", "Vector W8", "Shelby Mustang GT500", "Plymouth Superbird",
  // Track Monsters
  "McLaren Senna", "Ferrari FXX-K", "Aston Martin Vulcan", "Pagani Zonda R", 
  "Lamborghini Sesto Elemento", "KTM X-Bow", "Ariel Atom", "BAC Mono"
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
  // Reads the 'posted_history.txt' file to know what has been posted
  if (!fs.existsSync(HISTORY_FILE)) return new Set();
  const data = fs.readFileSync(HISTORY_FILE, "utf-8");
  return new Set(data.split("\n").filter(line => line.trim() !== ""));
}

function saveHistory(topic) {
  // Saves the new car to the file so it isn't repeated
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

// Cleans "Ferrari F40 (automobile)" -> "Ferrari F40"
function cleanTitle(title) {
  return title.replace(/ \(.+\)$/, "").trim();
}

// --- 1. WEB FETCH (RETRY MODE) ---
async function getWikiCar(history) {
  // Try 3 different categories if the first one only has duplicate cars
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      console.log(`🔎 Searching Wikipedia Category (Attempt ${attempt}/3): ${category}`);
      
      const url = "https://en.wikipedia.org/w/api.php";
      const res = await axios.get(url, {
        params: { 
          action: "query", 
          list: "categorymembers", 
          cmtitle: category, 
          cmlimit: 100, // Fetch 100 cars to increase odds of a new one
          format: "json", 
          origin: "*" 
        }
      });

      const members = res.data.query.categorymembers || [];
      
      // Filter out: Categories, Files, and ALREADY POSTED cars
      const valid = members.filter(m => {
        const title = cleanTitle(m.title);
        return !m.title.startsWith("Category:") && 
               !m.title.startsWith("List of") && 
               !m.title.startsWith("User:") &&
               !m.title.startsWith("File:") &&
               !m.title.startsWith("Template:") &&
               !history.has(title); // <--- CRITICAL: Checks if car is in history
      });

      if (valid.length > 0) {
        const chosen = valid[Math.floor(Math.random() * valid.length)].title;
        return cleanTitle(chosen);
      }
      
      console.log("⚠️ All cars in this category were already posted. Retrying new category...");
    } catch (e) { 
      console.error("Wiki Fetch Failed:", e.message);
    }
  }
  return null; // If 3 attempts fail, return null (will trigger backup list)
}

// --- 2. GENERATE CONTENT (GEMINI 2.5) ---
async function generateTweets(carName) {
  try {
    console.log(`🤖 Generating content for: ${carName}...`);
    
    const prompt = `Write a detailed 3-part viral Twitter thread about the '${carName}'.
    
    Structure:
    Tweet 1: A captivating Hook/Intro with rich description. Why is this car legendary?
    Tweet 2: Technical Specs & Mind-Blowing Facts. Use bullet points. Be specific about HP, Top Speed, or Engine.
    Tweet 3: Its Legacy, cultural impact, or why it matters today. End with 5-8 VIRAL HASHTAGS.

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
    
    if (parts.length === 3) return parts;
  } catch (e) {
    console.error("Gemini Failed:", e.message);
  }
  
  // Fallback
  console.log("⚠️ Using Fallback Template.");
  return [
    `Legendary Machine: ${carName} 🏎️\n\nA masterclass in automotive engineering and design. The way this machine dominates the road is unlike anything else in its class.\n\n(Thread 🧵) #Cars`,
    `The ${carName} is defined by its incredible performance and soul-stirring sound. 🏁\n\n• Engine: High-Revving Masterpiece\n• Speed: Blisteringly Fast\n• Design: Timeless`,
    `Is the ${carName} in your dream garage? 👇\n\n#${carName.replace(/\s/g, '')} #Supercars #Automotive #DreamCar #CarLovers #Motorsport #Legends`
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
  
  // 1. Try to find a new car from Wikipedia
  let topic = await getWikiCar(history);
  
  // 2. If Wiki failed (or all duplicates), try Backup List
  if (!topic) {
    console.log("⚠️ Wiki search exhausted. Checking Backup list for unposted cars...");
    // FILTER backups so we don't repeat even from the backup list
    const availableBackups = BACKUP_TOPICS.filter(t => !history.has(t));
    
    if (availableBackups.length > 0) {
      topic = availableBackups[Math.floor(Math.random() * availableBackups.length)];
    } else {
      // If literally everything is taken (very unlikely), pick random
      console.log("⚠️ All backups used! Picking random backup.");
      topic = BACKUP_TOPICS[Math.floor(Math.random() * BACKUP_TOPICS.length)];
    }
  }
  
  console.log(`🏎️ Topic: ${topic}`);

  const tweets = await generateTweets(topic);
  const images = await getImages(topic);
  const sessionId = generateSessionId();

  try {
    console.log("✅ Starting Tweet process...");

    let prevId = null;
    for (let i = 0; i < tweets.length; i++) {
      let text = tweets[i];
      if (i === 2) text += `\n\nRef: ${sessionId}`;
      text = safeTruncate(text);

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
        mediaIds = mediaIds.slice(0, 4);
      }

      const params = { text: text };
      if (mediaIds.length > 0) params.media = { media_ids: mediaIds };
      if (prevId) {
        params.reply = { in_reply_to_tweet_id: prevId };
        console.log(`🔗 Linking to thread parent: ${prevId}`);
      }

      console.log(`🐦 Posting Tweet ${i+1} (Length: ${text.length})...`);
      const resp = await client.v2.tweet(params);
      prevId = resp.data.id;
      console.log(`   Tweet Posted. ID: ${prevId}`);

      if (i < tweets.length - 1) {
        console.log("⏳ Waiting 3s for thread propagation...");
        await wait(3000); 
      }
    }

    // Save the new car to history so it's never picked again
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
