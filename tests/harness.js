/* Loads the built page's script into a sandbox with a stub DOM, so the tests
   exercise exactly the code that ships - not a copy of it. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXPORTS = ["sunTimes","moonTimes","moonIllumination","moonAltitude","skyFor",
  "tideAt","curAt","TIDE","CUR","HIGHS","LOWS","RANGE","fromNY","nyParts","dayStartNY",
  "dur","compass","windVsCurrent","windCurrentBand","immersionLede","waterWord",
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

function load(){
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
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
  vm.runInContext(m[1] + "\n;globalThis.__T={" + EXPORTS.join(",") + "};", ctx,
    {filename:"index.html<script>"});
  return {T: ctx.__T, els};
}
module.exports = {load};
