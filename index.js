const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// --- CONFIGURATION ---
const MAX_LENGTH = 280; //
const HISTORY_FILE = "posted_history.txt"; //
const CAR_COLORS = ["Nardo Grey", "Rosso Corsa", "British Racing Green", "Gulf Livery", "Triple Black", "Liquid Silver", "Papaya Orange"];

const WIKI_CATEGORIES = [
  "Category:Hypercars", "Category:Grand_tourers", "Category:Homologation_specials", 
  "Category:V12_engine_automobiles", "Category:V10_engine_automobiles", 
  "Category:Bugatti_vehicles", "Category:Koenigsegg_vehicles", "Category:Pagani_vehicles", 
  "Category:McLaren_vehicles", "Category:Lamborghini_vehicles", "Category:Ferrari_vehicles",
  "Category:Porsche_vehicles", "Category:Aston_Martin_vehicles"
]; //

// --- AUTHENTICATION ---
const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
}); //

const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY); //
const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY; //
const CX_ID = process.env.SEARCH_ENGINE_ID; //

// --- HELPERS ---
function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return new Set(); //
  const data = fs.readFileSync(HISTORY_FILE, "utf-8"); //
  return new Set(data.split("\n").filter(line => line.trim() !== "")); //
}

function saveHistory(topic) {
  fs.appendFileSync(HISTORY_FILE, `${topic}\n`); //
}

// --- 1. DYNAMIC TOPIC SELECTION ---
async function getWikiCar(history) {
  const genericTerms = ["luxury car", "concept car", "sports car", "supercar", "hypercar", "race car", "automobile", "vehicle", "car", "railcar"];

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      const res = await axios.get("https://en.wikipedia.org/w/api.php", {
        params: { action: "query", list: "categorymembers", cmtitle: category, cmlimit: 150, format: "json", origin: "*" },
        headers: { 'User-Agent': 'SuperCarBot/4.0' }
      }); //

      const members = res.data.query.categorymembers || []; //
      const valid = members.filter(m => {
        const title = m.title.toLowerCase();
        return !title.startsWith("category:") && !title.includes("list of") && !genericTerms.includes(title) && !history.has(m.title);
      }); //

      if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)].title.trim();
    } catch (e) { console.error("Wiki Fetch Failed:", e.message); }
  }
  return null;
}

// --- 2. MULTI-PERSPECTIVE THREAD GENERATION ---
async function generateCarThread(carName) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: "You are an elite automotive journalist. Write with high technical density and unique narrative flair. Avoid repetitive templates and clichéd praise."
    }); //

    const perspectives = [
      "Technical deep-dive into engine internals and aerodynamics.",
      "Historical narrative focusing on development origins and racing pedigree.",
      "Modern cultural impact and current market valuation/rarity."
    ];
    const chosenPerspective = perspectives[Math.floor(Math.random() * perspectives.length)];

    const prompt = `Topic: ${carName}. Perspective: ${chosenPerspective}.
    Write a 3-tweet thread. Each tweet MUST be 260-280 characters. 
    Tweet 1: High-density tech specs (Engine, induction, HP/TQ).
    Tweet 2: Engineering quirks or performance dynamics (Aero, suspension, or gearbox).
    Tweet 3: Rarity, legacy, and market significance + 4 hashtags.
    Return ONLY a JSON array: ["tweet1", "tweet2", "tweet3"]`;

    const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9 } }); //
    const content = result.response.text().trim().replace(/```json|```/g, ""); //
    return JSON.parse(content);
  } catch (e) {
    return [
      `The ${carName} features an elite power plant, pushing boundaries in raw horsepower and torque. 🏎️`,
      `Engineered with advanced composites to optimize power-to-weight ratios and handling precision. 💨`,
      `A rare specimen that continues to define automotive performance globally. #Supercars #${carName.replace(/\s/g, '')}`
    ];
  }
}

// --- 3. PRECISION IMAGE MATCHING ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  const paths = [];
  const usedUrls = new Set(); 
  
  const angleQueries = [
    { type: "hero", query: `"${carName}" ${color} car professional photo 4k` },
    { type: "engine", query: `"${carName}" engine bay detail view` },
    { type: "interior", query: `"${carName}" car dashboard cockpit cockpit` }
  ];

  for (let i = 0; i < angleQueries.length; i++) {
    try {
      const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
        params: { q: `${angleQueries[i].query} -toy -lego -model`, cx: CX_ID, key: GOOGLE_KEY, searchType: "image", imgSize: "xlarge", num: 5 } 
      }); //
      const items = res.data.items || [];
      const valid = items.filter(item => {
        const text = (item.title + " " + (item.snippet || "")).toLowerCase();
        return carName.toLowerCase().split(" ").every(word => text.includes(word));
      }); //

      if (valid.length > 0 && !usedUrls.has(valid[0].link)) {
        const imgPath = path.join(__dirname, `temp_${i}.jpg`);
        const response = await axios({ url: valid[0].link, method: "GET", responseType: "stream", timeout: 8000 }); //
        await new Promise((res, rej) => {
          const w = fs.createWriteStream(imgPath);
          response.data.pipe(w);
          w.on("finish", res);
          w.on("error", rej);
        });
        paths.push(imgPath);
        usedUrls.add(valid[0].link);
      }
    } catch (e) { console.error("Search Failed"); }
  }
  return paths;
}

// --- MAIN RUNNER ---
async function run() {
  const history = loadHistory();
  const topic = await getWikiCar(history);
  if (!topic) return console.log("No new cars found.");

  console.log(`🏎️ Generating unique thread for: ${topic}`);
  const threadTexts = await generateCarThread(topic);
  const images = await getImages(topic);

  try {
    let mediaIds = [];
    for (const img of images) {
      try {
        const mediaId = await client.v1.uploadMedia(img);
        mediaIds.push(mediaId);
      } catch (e) {}
    } //

    const threadItems = threadTexts.map((text, index) => {
      const item = { text: text.substring(0, MAX_LENGTH) };
      if (mediaIds[index]) item.media = { media_ids: [mediaIds[index]] };
      return item;
    }); //

    const resp = await client.v2.tweetThread(threadItems); //
    if (resp.length > 0) {
      saveHistory(topic); //
      console.log(`🚀 Posted! First ID: ${resp[0].data.id}`);
    }
  } catch (error) { console.error("Post Error:", error.message); }

  images.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
}

run();

