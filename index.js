const { GoogleGenAI } = require("@google/genai");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// --- CONFIGURATION ---
const MAX_LENGTH = 280;
const HISTORY_FILE = "posted_history.txt";
const CAR_COLORS = ["Nardo Grey", "Rosso Corsa", "British Racing Green", "Gulf Livery", "Triple Black", "Liquid Silver", "Papaya Orange", "Chalk", "Midnight Blue"];

const WIKI_CATEGORIES = [
  "Category:Hypercars", "Category:Grand_tourers", "Category:Homologation_specials", 
  "Category:V12_engine_automobiles", "Category:V10_engine_automobiles", 
  "Category:Bugatti_vehicles", "Category:Koenigsegg_vehicles", "Category:Pagani_vehicles", 
  "Category:McLaren_vehicles", "Category:Lamborghini_vehicles", "Category:Ferrari_vehicles",
  "Category:Porsche_vehicles", "Category:Aston_Martin_vehicles", "Category:Lotus_vehicles",
  "Category:Maserati_vehicles", "Category:Alfa_Romeo_vehicles"
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

// --- 1. INTELLIGENT TOPIC DISCOVERY ---
async function getWikiCar(history) {
  // Banned terms to ensure we only get specific car models
  const genericTerms = ["luxury car", "concept car", "sports car", "supercar", "hypercar", "race car", "automobile", "vehicle", "car", "railcar", "limousine", "truck", "suv"];

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const category = WIKI_CATEGORIES[Math.floor(Math.random() * WIKI_CATEGORIES.length)];
      const res = await axios.get("https://en.wikipedia.org/w/api.php", {
        params: { action: "query", list: "categorymembers", cmtitle: category, cmlimit: 150, format: "json", origin: "*" },
        headers: { 'User-Agent': 'SuperCarBot/5.0' }
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

// --- 2. "THINKING" THREAD GENERATION ---
async function generateCarThread(carName) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      // SYSTEM INSTRUCTION: Forces the AI to adopt a specific analytical persona
      systemInstruction: `You are a Technical Automotive Historian. 
      Your process:
      1. ANALYZE the specific car model (Engine code, Designer, Production years, Nürburgring time).
      2. IDENTIFY what makes it unique (e.g., "First carbon monocoque" or "V10 from F1").
      3. WRITE a 3-tweet thread based ONLY on these specific facts.
      4. Do NOT use generic fluff like "masterpiece" or "legend" without explaining WHY.`
    });

    // Randomize the angle so it doesn't sound the same every time
    const angles = [
      "Engineering Focus (Chassis, Suspension, Aero)",
      "Powertrain Focus (Engine internals, Sound, Gearbox)",
      "Historical Context (Rivals, Racing heritage, Market impact)"
    ];
    const chosenAngle = angles[Math.floor(Math.random() * angles.length)];

    const prompt = `Topic: ${carName}.
    Selected Angle: ${chosenAngle}.
    
    Task: Write a 3-tweet thread.
    - Tweet 1: Hook with HARD DATA (HP, 0-60, Engine Displacement).
    - Tweet 2: Deep dive into the '${chosenAngle}'. Mention specific part names or technologies.
    - Tweet 3: The Verdict. Why does this car matter today? Include 4 relevant hashtags.
    
    Constraints:
    - Use technical vocabulary.
    - Each tweet must be 250-280 characters long.
    - Return ONLY a raw JSON array of strings: ["tweet1", "tweet2", "tweet3"]`;
    
    const result = await model.generateContent({ 
        contents: [{ role: "user", parts: [{ text: prompt }] }], 
        generationConfig: { temperature: 0.85 } // High creativity to ensure unique phrasing
    });
    
    const content = result.response.text().trim().replace(/```json|```/g, "");
    return JSON.parse(content);

  } catch (e) {
    console.error("Gemini Generation Error:", e.message);
    // Fallback if AI fails (Safety net)
    return [
      `The ${carName} is a definitive machine of its era. 🏎️`,
      `With engineering that pushes the limits of performance. ⚙️`,
      `A true icon of the road. #Supercars #${carName.replace(/\s/g, '')}`
    ];
  }
}

// --- 3. CONTEXT-AWARE IMAGE FETCH ---
async function getImages(carName) {
  if (!GOOGLE_KEY) return [];
  const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  const paths = [];
  const usedUrls = new Set(); 
  
  // Specific queries to get high-quality variety
  const angleQueries = [
    { type: "hero", query: `"${carName}" ${color} car front 3/4 view 4k` },
    { type: "rear",  query: `"${carName}" ${color} car rear view wallpaper` },
    { type: "detail", query: `"${carName}" engine bay or interior cockpit detail` }
  ];

  // Exclude toys and bad sites
  const exclusions = "-site:pinterest.* -site:ebay.* -site:amazon.* -toy -model -diecast -scale -lego -r/c -drawing -sketch -render -3d -videogame -assetto -forza";

  for (let i = 0; i < angleQueries.length; i++) {
    try {
      const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
        params: { q: `${angleQueries[i].query} ${exclusions}`, cx: CX_ID, key: GOOGLE_KEY, searchType: "image", imgSize: "xlarge", num: 8 } 
      });
      
      const items = res.data.items || [];
      const nameKeywords = carName.toLowerCase().split(" ").filter(w => w.length > 2);

      // VALIDATION: Ensure the image title/snippet actually contains the car name
      const validItems = items.filter(item => {
        const text = (item.title + " " + (item.snippet || "")).toLowerCase();
        // Check if at least 75% of the car name words are present
        const matches = nameKeywords.filter(w => text.includes(w)).length;
        return (matches / nameKeywords.length) >= 0.75;
      });

      if (validItems.length > 0) {
        // Try to download the best match
        for (const item of validItems) {
            if (!usedUrls.has(item.link)) {
                try {
                    const imgPath = path.join(__dirname, `temp_${i}_${Date.now()}.jpg`);
                    const response = await axios({ url: item.link, method: "GET", responseType: "stream", timeout: 8000 });
                    await new Promise((res, rej) => {
                        const w = fs.createWriteStream(imgPath);
                        response.data.pipe(w);
                        w.on("finish", res);
                        w.on("error", rej);
                    });
                    paths.push(imgPath);
                    usedUrls.add(item.link);
                    break; // Move to next angle once successful
                } catch(e) { console.error("Download failed, trying next..."); }
            }
        }
      }
    } catch (e) { console.error("Search API Failed:", e.message); }
  }
  return paths;
}

// --- MAIN RUNNER ---
async function run() {
  const history = loadHistory();
  const topic = await getWikiCar(history);
  
  if (!topic) return console.log("No new topics found.");

  console.log(`🧠 AI Thinking about: ${topic}...`);
  const threadTexts = await generateCarThread(topic);
  const images = await getImages(topic);

  try {
    let mediaIds = [];
    for (const img of images) {
      try {
        const mediaId = await client.v1.uploadMedia(img);
        mediaIds.push(mediaId);
      } catch (e) { console.error("Media Upload Error"); }
    }

    // Attach images to specific tweets in the thread
    const threadItems = threadTexts.map((text, index) => {
      const item = { text: text.substring(0, MAX_LENGTH) };
      // Tweet 1 gets image 1, Tweet 2 gets image 2, etc.
      if (mediaIds[index]) item.media = { media_ids: [mediaIds[index]] };
      return item;
    });

    const resp = await client.v2.tweetThread(threadItems);
    if (resp.length > 0) {
      saveHistory(topic);
      console.log(`🚀 Thread Posted: https://twitter.com/user/status/${resp[0].data.id}`);
    }
  } catch (error) { console.error("Critical Post Error:", error.message); }

  // Cleanup
  images.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
}

run();

