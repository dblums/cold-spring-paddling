/* Loads the built page's script into a sandbox with a stub DOM, so the tests
   exercise exactly the code that ships - not a copy of it. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXPORTS = ["SITE","WX","sunTimes","moonTimes","moonIllumination","moonAltitude","skyFor",
  "tideAt","curAt","TIDE","CUR","HIGHS","LOWS","RANGE","fromNY","nyParts","dayStartNY",
  "dur","compass","windVsCurrent","immersionLede","groundSpeedMph","headwindMph","speedsFor","buildBrief","speedNote","directionOutlook","windWord","briefConcerns","LEVELS","HEADLINE","scene","quietDay","riverAhead","pleasantEnough","plainHead","goodHead","COLD_WATER_F","briefFacts","feelsLike","tempWord","precipWord","PADDLE_POWER",
  "blockedAt","muddyAt","nearestIn","conditionsAt","valueAt","isoDurMs","skyWord",
  "PADDLE_MPH","TRESTLE_MIN","MUD_MIN","TIDE_SHIFT_MIN","CUR_SHIFT_MIN","MIN"];

function stubEl(){
  const el = {
    textContent:"", innerHTML:"", className:"", value:"", style:{},
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
           .sort((a,b) => (b.root?1:0) - (a.root?1:0));
}
function pageFor(site){
  return site.root ? path.join(__dirname, "..", "index.html")
                   : path.join(__dirname, "..", site.slug, "index.html");
}

function load(site){
  const file = site ? pageFor(site) : path.join(__dirname, "..", "index.html");
  const html = fs.readFileSync(file, "utf8");
  const m = /<script>\n([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no <script> found in index.html");
  const els = {};
  const ctx = vm.createContext({
    document:{
      getElementById:id => (els[id] = els[id] || stubEl()),
      createElement:() => stubEl(),
      createElementNS:() => stubEl()
    },
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
  return {T: ctx.__T, els};
}
module.exports = {load, sites, pageFor};
