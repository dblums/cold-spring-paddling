/* Loads the built page's script into a sandbox with a stub DOM, so the tests
   exercise exactly the code that ships - not a copy of it. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXPORTS = ["SITE","WX","sunTimes","moonTimes","moonIllumination","moonAltitude","skyFor",
  "tideAt","curAt","TIDE","CUR","HIGHS","LOWS","RANGE","fromNY","nyParts","dayStartNY",
  "dur","compass","windVsCurrent","esc","safeHref","immersionLede","groundSpeedMph","headwindMph","speedsFor","buildBrief","speedNote","directionOutlook","windWord","briefConcerns","LEVELS","HEADLINE","quietDay","riverAhead","pleasantEnough","waterWord","waterHead","curWord","slackSoon","quietDay","COLD_WATER_F","briefFacts","feelsLike","tempWord","precipWord","PADDLE_POWER",
  "blockedAt","muddyAt","nearestIn","conditionsAt","valueAt","isoDurMs","skyWord",
  "PADDLE_MPH","TRESTLE_MIN","MUD_MIN","TIDE_SHIFT_MIN","CUR_SHIFT_MIN","MIN",
  "readWater","cacheWater","cachedWater","ago","WATER_KEEP_MS","WATER_KEY",
  "WATER_ALL","waterCost","bestWater","waterSub","AGE_MILES_PER_DAY",
  "WATER_S","WATER_N","WATER_NEAR"];

/* The page keeps the last good water reading here. The real thing can be
   missing or refuse to write, which the page swallows - so the tests get a
   working one and check the swallowing separately. */
function memStore(){
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    get size(){ return m.size; }
  };
}

function stubEl(){
  const el = {
    textContent:"", innerHTML:"", className:"", value:"", style:{}, dataset:{}, href:"",
    classList:{add(){}, remove(){}, contains(){return false}},
    addEventListener(){}, appendChild(){}, setAttribute(){}, setPointerCapture(){},
    getBoundingClientRect:() => ({left:0, width:720}),
    querySelector:() => null, querySelectorAll:() => []
  };
  return el;
}

/* Every built page, so the tests run against each launch site rather than
   assuming there is only one. */
function sites(){
  const dir = path.join(__dirname, "..", "locations");
  return fs.readdirSync(dir).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
           .sort((a,b) => (b.primary?1:0) - (a.primary?1:0));
}
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pageSlug = site => slugify(site.slug) + "-" + slugify(site.state);
function pageFor(site){
  return path.join(__dirname, "..", pageSlug(site) + ".html");
}

function load(site){
  const file = pageFor(site || sites()[0]);
  const html = fs.readFileSync(file, "utf8");
  const m = /<script>\n([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no <script> found in index.html");
  const els = {};
  const store = memStore();
  const ctx = vm.createContext({
    document:{
      getElementById:id => (els[id] = els[id] || stubEl()),
      createElement:() => stubEl(),
      createElementNS:() => stubEl(),
      // the page wires up document-level listeners for the locations menu
      addEventListener(){}, removeEventListener(){},
      querySelector:() => null, querySelectorAll:() => []
    },
    localStorage: store,
    setInterval:() => {}, setTimeout:() => {},
    fetch:() => Promise.reject(new Error("network disabled in tests")),
    console, Intl, Date, Math, JSON, Promise, Error,
    parseFloat, parseInt, isFinite, isNaN, String, Number, Array, Object
  });
  // feature-gated symbols are absent on sites without that feature, so probe
  // each one rather than assuming it exists
  const grab = "\n;globalThis.__T={};" +
    EXPORTS.map(n => `try{globalThis.__T.${n}=${n}}catch(e){}`).join("");
  vm.runInContext(m[1] + grab, ctx, {filename:"index.html<script>"});
  return {T: ctx.__T, els, store};
}
module.exports = {load, sites, pageFor, pageSlug, memStore};
