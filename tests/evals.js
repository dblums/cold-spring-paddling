/* Evals for the generated summary.
   ---------------------------------------------------------------------------
   These are not unit tests. There is no single correct sentence, so asserting
   string equality would be both brittle and beside the point. What we can
   assert are PROPERTIES the copy must hold whatever words it picks:

     severity    a given set of conditions must produce a given verdict
     content     certain conditions must be mentioned; others must not appear
     coherence   the copy must not contradict its own headline
     numeracy    every figure in the prose must match what the page computed
     monotonic   worsening one input must never produce a friendlier verdict

   Run: node tests/evals.js
*/
const {load} = require("./harness.js");
const {T} = load();

let pass = 0, fail = 0;
const failures = [];
function check(scenario, prop, cond, detail){
  if (cond) pass++;
  else { fail++; failures.push(`  ${scenario}\n    ${prop}${detail ? "\n      " + detail : ""}`); }
}

/* ---------- the world, held still ---------- */
const NOON = T.fromNY(2026, 6, 15, 12, 0);     // mid-June, long day, nothing else going on
const EVENING = T.fromNY(2026, 6, 15, 19, 30); // an hour or so before sunset

function run(s){
  T.WX.alerts = (s.alerts || []).map(e => ({properties:{event:e.event, severity:e.severity}}));
  const w = s.wind === null ? null : {
    windMph: s.wind, windGustMph: s.gust != null ? s.gust : s.wind,
    windFromDeg: s.from != null ? s.from : 0,
    airF: s.air, waterF: s.water, stormPct: s.storm || 0
  };
  const t = s.at || NOON;
  return T.buildBrief(t, s.cur || 0, w, T.skyFor(t));
}

/* ---------- scenarios ----------
   cur is knots, positive flooding north (the water travels toward ~10 deg).
   from is the direction the wind comes FROM, so it blows toward from+180.
   A northerly (from: 0) therefore OPPOSES a flood and runs WITH an ebb.
   I got this backwards writing these fixtures the first time, which is rather
   the point of having them. */
const SCENARIOS = [
  { name: "glassy June morning",
    wind: 4, from: 315, cur: 0.05, air: 72, water: 70,
    level: "good",
    must: [/2\.\d mph|3\.\d mph/],
    mustNot: [/wetsuit|drysuit/i, /advisory/i, /chop/i] },

  { name: "ordinary day, ebb running",
    wind: 8, from: 180, cur: -0.5, air: 74, water: 71,
    level: "fine",
    must: [/mph/],
    mustNot: [/wetsuit/i, /windy/i] },

  { name: "windy, 20 gusting 28",
    wind: 20, gust: 28, from: 0, cur: 0.2, air: 66, water: 68,
    level: "warn",
    must: [/20 mph/, /28/],
    mustNot: [/good day/i] },

  { name: "nor'easter, 25 gusting 40, advisory out",
    wind: 25, gust: 40, from: 45, cur: -0.8, air: 58, water: 66,
    alerts: [{event:"Wind Advisory", severity:"Moderate"}],
    level: "stop",
    must: [/25 mph/, /40/],
    mustNot: [/not dangerous/i, /bumpy/i, /good day/i, /relax/i, /easy way/i] },

  { name: "nor'easter onto a flood - the copy must not reassure",
    wind: 25, gust: 40, from: 0, cur: 0.9, air: 58, water: 66,
    level: "stop",
    must: [/25 mph/],
    mustNot: [/not dangerous/i, /bumpy/i, /if you are dressed/i] },

  { name: "severe thunderstorm warning",
    wind: 10, from: 180, cur: 0.3, air: 78, water: 72,
    alerts: [{event:"Severe Thunderstorm Warning", severity:"Severe"}],
    level: "stop",
    must: [/Severe Thunderstorm Warning/],
    mustNot: [/good day/i, /fine for a paddle/i] },

  { name: "warm April afternoon, cold river",
    wind: 6, from: 225, cur: 0.2, air: 70, water: 46,
    level: "caution",
    must: [/46/, /70/, /wetsuit or drysuit/i],
    mustNot: [/good day/i] },

  { name: "freezing water, calm air",
    wind: 5, from: 0, cur: 0.1, air: 44, water: 38,
    level: "caution",
    must: [/dress for the water/i],
    mustNot: [/good day/i] },

  { name: "wind against a strong flood",
    wind: 14, from: 0, cur: 0.9, air: 72, water: 70,
    level: "caution",
    must: [/chop/i],
    mustNot: [/smooth/i] },

  { name: "same wind, same current, running together",
    wind: 14, from: 180, cur: 0.9, air: 72, water: 70,
    level: "fine",
    mustNot: [/chop/i, /fighting/i] },

  { name: "pure crosswind, 18 mph",
    wind: 18, from: 90, cur: 0.3, air: 70, water: 68,
    level: "warn",
    must: [/18 mph/],
    mustNot: [/no forward progress/i] },

  { name: "thunderstorms likely",
    wind: 9, from: 200, cur: 0.2, air: 80, water: 74, storm: 55,
    level: "caution",
    must: [/55%|thunderstorm/i] },

  { name: "an hour before sunset",
    wind: 5, from: 180, cur: 0.2, air: 70, water: 68, at: EVENING,
    level: "caution",
    must: [/daylight|sunset/i] },

  { name: "no weather data at all",
    wind: null, cur: 0.6, air: null, water: null,
    level: "fine",          // not "good" - with no wind reading we cannot claim it
    must: [/mph/],
    mustNot: [/undefined|NaN|null/] }
];

/* ---------- properties ---------- */
console.log("SEVERITY, CONTENT AND COHERENCE\n");
for (const s of SCENARIOS){
  const b = run(s);
  const text = b.head + " " + b.body;
  check(s.name, `level should be ${s.level}, got ${b.level}`, b.level === s.level, text.slice(0, 110));
  for (const re of s.must || [])
    check(s.name, `copy must mention ${re}`, re.test(text), text.slice(0, 140));
  for (const re of s.mustNot || [])
    check(s.name, `copy must NOT contain ${re}`, !re.test(text), text.slice(0, 140));

  // coherence: the headline must speak for the verdict, not for a lesser worry
  const heads = T.briefConcerns(s.at || NOON, s.cur || 0,
    s.wind === null ? null : {windMph:s.wind, windGustMph:s.gust != null ? s.gust : s.wind,
      windFromDeg:s.from != null ? s.from : 0, airF:s.air, waterF:s.water, stormPct:s.storm || 0},
    T.skyFor(s.at || NOON)).concerns.filter(c => c.level === b.level).map(c => c.head);
  if (heads.length) check(s.name, `headline must come from a ${b.level}-level concern`,
    heads.includes(b.head), `"${b.head}" vs [${heads.join(" | ")}]`);

  // coherence: a stop verdict may not also reassure
  if (b.level === "stop")
    check(s.name, "a stop verdict must not soften itself",
      !/not dangerous|should stay smooth|bumpy ride|easy way|nothing much/i.test(text), text.slice(0,140));

  // numeracy: every mph figure quoted must be one the page actually computed
  const quoted = [...text.matchAll(/([\d.]+) mph/g)].map(m => parseFloat(m[1]));
  const allowed = [Math.abs(b.speeds.north), Math.abs(b.speeds.south), s.wind, s.gust, T.PADDLE_MPH]
    .filter(v => v != null).map(v => +v.toFixed(1));
  const bogus = quoted.filter(q => !allowed.some(a => Math.abs(a - q) < 0.06));
  check(s.name, `every mph figure must be real (saw ${quoted.join(", ") || "none"})`,
    bogus.length === 0, bogus.length ? "unexplained: " + bogus.join(", ") : "");

  check(s.name, "no empty or stub copy", b.head.length > 8 && b.body.length > 25, text.slice(0,80));
  check(s.name, "no unrendered values", !/undefined|NaN|\[object/.test(text), text.slice(0,140));
}

/* ---------- monotonicity ---------- */
console.log("MONOTONICITY\n");
{
  const base = {from:0, cur:0.3, air:70, water:68};
  let prev = null, ok = true, detail = "";
  for (const wind of [2,5,8,12,15,18,20,22,25,30,35]){
    const b = run({...base, wind, gust: wind + 8, name:"sweep"});
    const rank = T.LEVELS.indexOf(b.level);
    if (prev !== null && rank > prev){ ok = false; detail = `wind ${wind} gave a friendlier level than the step before`; }
    prev = prev === null ? rank : Math.min(prev, rank);
  }
  check("wind sweep 2 -> 35 mph", "more wind must never give a friendlier verdict", ok, detail);

  let coldOK = true, coldDetail = "";
  for (const water of [75,70,65,60,55,50,45,40]){
    const b = run({wind:5, from:0, cur:0.2, air:70, water, name:"cold sweep"});
    if (water <= 50 && b.level === "good"){ coldOK = false; coldDetail = `${water}F water still reported as a good day`; }
  }
  check("water temp sweep 75 -> 40F", "cold water must never read as a good day", coldOK, coldDetail);

  // speeds must fall as the headwind rises
  let speedOK = true, last = Infinity;
  for (const wind of [0,5,10,15,20,25,30]){
    const v = T.groundSpeedMph(0, wind);
    if (v > last) speedOK = false;
    last = v;
  }
  check("headwind sweep", "ground speed must fall monotonically as headwind rises", speedOK);
}

/* ---------- report ---------- */
console.log(`${pass} properties held, ${fail} failed\n`);
if (failures.length){ console.log("FAILURES\n"); console.log(failures.join("\n\n")); }
process.exit(fail ? 1 : 0);
