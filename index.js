const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// --- CONFIGURATION ---
const MAX_LENGTH = 280; // Increased to Twitter's max
const HISTORY_FILE = "posted_history.txt";

// --- EXPANDED LIBRARY ---
const WIKI_CATEGORIES = [
  "Category:Supercars", 
  "Category:Hypercars",
  "Category:Sports_cars", 
  "Category:Grand_tourers", 
  "Category:Rally_cars",
  "Category:Group_B_cars",
  "Category:Le_Mans_prototypes",
  "Category:Concept_cars",
  "Category:Homologation_specials",
  "Category:V12_engine_automobiles"
];

const BACKUP_TOPICS = [
  // The Holy Trinity
  "McLaren P1", "Porsche 918 Spyder", "Ferrari LaFerrari",
  // 90s Legends
  "McLaren F1", "Ferrari F40", "Porsche 959", "Bugatti EB110", "Jaguar XJ220", "Mercedes-Benz CLK GTR", "Porsche 911 GT1", "Nissan R390 GT1",
  // Modern Hypercars
  "Bugatti Chiron", "Koenigsegg Jesko", "Pagani Huayra", "Aston Martin Valkyrie", "Mercedes-AMG One", "Rimac Nevera", "Lotus Evija", "Hennessey Venom F5", "SSC Tuatara",
  // JDM Legends
  "Nissan Skyline GT-R R34", "Mazda 787B", "Toyota Supra MK4", "Honda NSX-R", "Lexus LFA", "Subaru Impreza 22B", "Mitsubishi Lancer Evolution VI",
  // Italian Icons
  "Lamborghini Countach", "Lamborghini Miura", "Ferrari Enzo", "Ferrari F50", "Pagani Zonda Cinque", "Lamborghini Diablo GT", "Alfa Romeo 33 Stradale", "Lancia Stratos", "Maserati MC12",
  // German Engineering
  "Porsche Carrera GT", "Mercedes-Benz 300SL Gullwing", "BMW M1", "Audi Quattro S1", "BMW E46 M3 GTR", "Porsche 917K", "Mercedes-Benz SLR McLaren",
  // American Muscle/Super
  "Ford GT40", "Shelby Cobra 427", "Dodge Viper ACR", "Chevrolet Corvette C8 Z06", "Saleen S7", "Ford GT (2005)", "Vector W8",
  // Track Monsters
  "McLaren Senna", "Ferrari FXX-K", "Aston Martin Vulcan", "Pagani Zonda R", "Lamborghini Sesto Elemento", "KTM X-Bow", "Ariel Atom", "BAC Mono",
  // Classics
  "Aston Martin DB5", "Ferrari 250 GTO", "Jaguar E-Type", "Toyota 2000GT", "Lamborghini Miura SV"
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

// Delay to fix threading
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// --- 2. GENERATE CONTENT (GEMINI 2.5) ---
async function generateTweets(carName) {
  try {
    console.log(`🤖 Generating content for: ${carName}...`);
    
    // UPDATED PROMPT: Demands longer, richer content
    const prompt = `Write a detailed 3-part viral Twitter thread about the '${carName}'.
    
    Structure:
    Tweet 1: A captivating Hook/Intro with rich description. Why is this car legendary? (Use ~250 chars).
    Tweet 2: Technical Specs & Mind-Blowing Facts. Use bullet points. Be specific about HP, Top Speed, or Engine. (Use ~250 chars).
    Tweet 3: Its Legacy, cultural impact, or why it matters today. End with 5-8 VIRAL HASHTAGS. (Use ~250 chars).

    Rules:
    - Separate tweets strictly with '|||'.
    - Use Emoji to make it pop.
    - Max ${MAX_LENGTH} chars per tweet (Make them long!).
    - No markdown bolding (no **text**).`;

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
  
  let topic = await getWikiCar(history);
  if (!topic) topic = BACKUP_TOPICS[Math.floor(Math.random() * BACKUP_TOPICS.length)];
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

      console.log(`🐦 Posting Tweet ${i+1}...`);
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
