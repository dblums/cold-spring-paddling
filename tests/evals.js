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
const DAY = 24 * 3600 * 1000;

// Phrases that must never appear in any summary, whatever the conditions.
// "Nothing to watch out for" is the page inviting someone to stop paying
// attention, which is not its job on a river.
const NEVER = [/nothing (much )?to watch out for/i, /you'?ll be fine/i, /no need to worry/i,
               /perfectly safe/i, /don'?t worry/i,
               // the page informs and suggests; it never rules on whether to go
               /not a day for paddling/i, /too windy to paddle/i, /do ?n'?t paddle/i,
               /stay (home|ashore)/i, /wait this one out/i, /a glorious day for a paddle/i,
               /you should (not )?go/i];

function run(s){
  T.WX.alerts = (s.alerts || []).map(e => ({properties:{event:e.event, severity:e.severity,
    ends: e.ends != null ? new Date(e.ends).toISOString() : undefined}}));
  const w = s.wind === null ? null : {
    windMph: s.wind, windGustMph: s.gust != null ? s.gust : s.wind,
    windFromDeg: s.from != null ? s.from : 0,
    airF: s.air, waterF: s.water, stormPct: s.storm || 0
  };
  if (w && s.skyPct != null){ w.skyPct = s.skyPct; w.skyText = T.skyWord(s.skyPct); }
  if (w && s.wx) w.wx = T.precipWord([{weather:s.wx, coverage:s.wxCoverage || "likely"}]);
  if (w && s.precipPct != null) w.precipPct = s.precipPct;
  const t = s.at || NOON;
  // a fixed present, so "is it a forecast?" does not depend on the wall clock
  const now = s.now != null ? s.now : t + DAY;
  const b = T.buildBrief(t, s.cur || 0, w, T.skyFor(t), now);
  b.__in = {t, cv: s.cur || 0, w, now};   // so properties test the same inputs
  return b;
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
    mustNot: [/wetsuit|drysuit/i, /advisory/i, /chop/i] },

  { name: "ordinary day, ebb running",
    // dry, 8 mph, 74F air over 71F water: this one does clear the pleasant bar
    wind: 8, from: 180, cur: -0.5, air: 74, water: 71,
    level: "good",
    mustNot: [/wetsuit/i, /windy/i] },

  // ---- the pleasant bar, one failing ingredient at a time ----
  { name: "pleasant but for the rain",
    wind: 6, from: 180, cur: -0.5, air: 74, water: 71, wx: "rain",
    level: "fine",
    // the headline names the air and the rain; the sky is nobody's decision
    must: [/mild air/i, /rain/i],
    mustNot: [/pleasant|beautiful|glassy/i] },

  { name: "pleasant but for the cool air",
    wind: 6, from: 180, cur: -0.5, air: 61, water: 71, skyPct: 10,
    level: "fine",
    mustNot: [/pleasant|beautiful|glassy/i] },

  { name: "pleasant but for the cold water",
    wind: 6, from: 180, cur: -0.5, air: 74, water: 57, skyPct: 10,
    // water under 60 is a concern now, so this is no longer a quiet day
    level: "caution",
    must: [/cold water/i],
    mustNot: [/pleasant|beautiful|glassy/i] },

  { name: "pleasant but for the wind",
    wind: 12, from: 180, cur: -0.2, air: 74, water: 71, skyPct: 10,
    level: "fine",
    mustNot: [/pleasant|beautiful|glassy/i] },

  { name: "pleasant but for the thunder risk",
    wind: 6, from: 180, cur: -0.5, air: 80, water: 74, storm: 25, skyPct: 40,
    level: "caution",
    mustNot: [/pleasant|beautiful|glassy/i] },

  { name: "pleasant but for the chance of rain",
    wind: 6, from: 180, cur: -0.5, air: 74, water: 71, precipPct: 50, skyPct: 70,
    level: "fine",
    must: [/chance of rain/i],
    mustNot: [/pleasant|beautiful|glassy/i] },

  { name: "genuinely glassy",
    wind: 4, from: 180, cur: 0.1, air: 76, water: 70, skyPct: 5,
    level: "good",
    must: [/glassy water/i] },

  { name: "still air over a running river is not glassy",
    wind: 3, from: 180, cur: -1.5, air: 76, water: 70, skyPct: 5,
    level: "good",
    // a current that strong is the headline, not the cloudless sky
    must: [/warm air/i, /strong current/i],
    mustNot: [/glassy/i, /still/i] },

  { name: "hot, light air, current running",
    wind: 5, from: 190, cur: 0.3, air: 89, water: 78, skyPct: 10,
    level: "good",
    must: [/hot air/i],
    // "still" is a lie with a knot under you, and off Manhattan it never is
    mustNot: [/glassy|beautiful|still/i] },

  // the May trap: 72 + 52 = 124 clears the 120 rule, and 52F water does not care
  { name: "warm May afternoon over cold water",
    wind: 7, from: 200, cur: 0.4, air: 72, water: 52, skyPct: 15,
    level: "caution",
    must: [/cold water/i, /wet or drysuit/i, /only 52/i],
    // "dress for the water" was being said three times on one screen
    mustNot: [/cool water/i, /combined/i, /dress for the water/i] },

  // the immersion advice trips on cold air too, and then the water is fine
  { name: "cold air over a river that is not cold",
    wind: 7, from: 200, cur: 0.4, air: 49, water: 72, skyPct: 20,
    level: "caution",
    must: [/cold air/i, /only 49/i],
    mustNot: [/cold water/i, /the water is cold/i] },

  { name: "cold air and cold water is a water story",
    wind: 7, from: 200, cur: 0.4, air: 49, water: 56, skyPct: 20,
    level: "caution",
    must: [/cold water/i, /only 56/i],
    mustNot: [/chill you fast/i] },

  { name: "cold water with cold air still cites the combined rule",
    wind: 7, from: 320, cur: 0.8, air: 48, water: 58, skyPct: 5,
    level: "caution",
    must: [/cold water/i, /wet or drysuit/i] },

  { name: "one way much easier than the other",
    wind: 18, gust: 24, from: 0, cur: 0.2, air: 66, water: 68,
    level: "warn",
    factsMust: [/18 mph/],
    mustNot: [/every bit of ground/i, /shoved around/i] },

  { name: "windy, 20 gusting 28",
    wind: 20, gust: 28, from: 0, cur: 0.2, air: 66, water: 68,
    level: "warn",
    factsMust: [/20 mph/, /28/],
    mustNot: [/good day/i] },

  { name: "nor'easter, 25 gusting 40, advisory out",
    wind: 25, gust: 40, from: 45, cur: -0.8, air: 58, water: 66,
    alerts: [{event:"Wind Advisory", severity:"Moderate"}],
    level: "stop",
    factsMust: [/25 mph/, /40/],
    mustNot: [/not dangerous/i, /bumpy/i, /good day/i, /relax/i, /easy way/i] },

  { name: "nor'easter onto a flood - the copy must not reassure",
    wind: 25, gust: 40, from: 0, cur: 0.9, air: 58, water: 66,
    level: "stop",
    factsMust: [/25 mph/],
    mustNot: [/not dangerous/i, /bumpy/i, /if you are dressed/i] },

  { name: "severe thunderstorm warning",
    wind: 10, from: 180, cur: 0.3, air: 78, water: 72,
    alerts: [{event:"Severe Thunderstorm Warning", severity:"Severe"}],
    level: "stop",
    must: [/Severe Thunderstorm Warning/i],
    mustNot: [/good day/i, /fine for a paddle/i] },

  { name: "warm April afternoon, cold river",
    wind: 6, from: 225, cur: 0.2, air: 70, water: 46,
    level: "caution",
    must: [/wet or drysuit|wetsuit/i, /be careful/i, /dress for immersion/i],
    factsMust: [/46/, /70/],
    mustNot: [/good day/i] },

  { name: "freezing water, calm air",
    wind: 5, from: 0, cur: 0.1, air: 44, water: 38,
    level: "caution",
    must: [/dress for immersion/i, /wet or drysuit|wetsuit|drysuit/i],
    mustNot: [/good day/i] },

  { name: "advisory plus chop - the reassurance must not survive",
    wind: 23, gust: 33, from: 22, cur: 1.3, air: 58, water: 66,
    alerts: [{event:"Wind Advisory", severity:"Moderate"}],
    level: "warn",
    must: [/advisor/i, /chop/i],
    mustNot: [/not dangerous/i, /bumpy/i] },

  /* Wind against tide needs a real breeze or a real current before it is worth
     flagging. A moderate wind over most of a knot is a texture on the water;
     the headline says so and the page stays out of the way. */
  { name: "moderate wind against a moderate flood is not a warning",
    wind: 14, from: 0, cur: 0.9, air: 72, water: 70,
    level: "fine",
    must: [/chop/i],
    mustNot: [/smooth/i, /choppy out there/i] },

  { name: "the same wind over a hard flood is",
    wind: 14, from: 0, cur: 1.6, air: 72, water: 70,
    level: "caution",
    must: [/chop/i],
    mustNot: [/smooth/i] },

  { name: "wind against a strong flood, really blowing",
    wind: 18, from: 0, cur: 1.0, air: 72, water: 70,
    level: "warn",
    must: [/chop/i],
    mustNot: [/smooth/i] },

  { name: "same wind, same current, running together",
    wind: 14, from: 180, cur: 0.9, air: 72, water: 70,
    level: "fine",
    mustNot: [/chop/i, /fighting/i] },

  { name: "pure crosswind, 18 mph",
    wind: 18, from: 90, cur: 0.3, air: 70, water: 68,
    level: "warn",
    factsMust: [/18 mph/],
    mustNot: [/no forward progress/i] },

  { name: "thunderstorms likely",
    wind: 9, from: 200, cur: 0.2, air: 80, water: 74, storm: 55,
    level: "warn",               // 50% and up is a warn, not a caution
    must: [/thunderstorm/i] },

  { name: "an hour before sunset",
    wind: 5, from: 180, cur: 0.2, air: 70, water: 68, at: EVENING,
    level: "caution",
    must: [/daylight|sunset/i] },

  { name: "after dark",
    wind: 5, from: 180, cur: 0.2, air: 70, water: 68, at: T.fromNY(2026, 6, 15, 22, 30),
    level: "warn",
    // 33 CFR 83.25(d)(ii) and NY Nav Law 43: this is the law, not a suggestion
    must: [/dark/i, /white light/i, /required/i],
    mustNot: [/good day/i, /you would want/i] },

  { name: "after dark, bright moon, clear sky",
    wind: 5, from: 180, cur: 0.2, air: 70, water: 68, skyPct: 5,
    at: T.fromNY(2026, 7, 29, 23, 30),
    level: "warn",
    must: [/white light/i, /required/i, /moon/i] },

  { name: "after dark, bright moon, overcast",
    wind: 5, from: 180, cur: 0.2, air: 70, water: 68, skyPct: 95,
    at: T.fromNY(2026, 7, 29, 23, 30),
    level: "warn",
    // a full moon behind a deck of cloud is not company
    must: [/white light/i],
    mustNot: [/moon/i] },

  { name: "after dark, bright moon, sky unknown",
    wind: 5, from: 180, cur: 0.2, air: 70, water: 68,
    at: T.fromNY(2026, 7, 29, 23, 30),
    level: "warn",
    mustNot: [/moon/i] },

  { name: "just after sunset",
    wind: 5, from: 180, cur: 0.2, air: 70, water: 68, at: T.fromNY(2026, 6, 15, 20, 45),
    level: "caution",
    // lights are due from sunset, not from full dark
    must: [/sun is down|sunset/i, /white light/i] },

  // ---- tense: a forecast is not a report from the riverbank ----
  { name: "planning ahead, rain",
    wind: 6, from: 180, cur: 0.2, air: 64, water: 66, skyPct: 95, wx: "rain",
    at: EVENING, now: T.fromNY(2026, 6, 13, 9, 0),
    level: "caution",
    must: [/the forecast calls for/i, /not much daylight left/i],
    mustNot: [/\bit is (mild|cool|warm|cold|hot|raining|overcast)/i,
              /sun is going down/i] },

  { name: "planning ahead, quiet day",
    wind: 4, from: 180, cur: 0.2, air: 72, water: 70, skyPct: 5,
    at: NOON, now: T.fromNY(2026, 6, 13, 9, 0),
    level: "good",
    must: [/the forecast calls for/i] },

  { name: "planning ahead, after dark",
    wind: 5, from: 180, cur: 0.2, air: 70, water: 68, skyPct: 95,
    at: T.fromNY(2026, 6, 15, 22, 30), now: T.fromNY(2026, 6, 13, 9, 0),
    level: "warn",
    must: [/dark by then/i, /white light/i],
    mustNot: [/\bdark out\b/i] },

  // ---- tense: weather is a forecast, the river is a prediction ----
  { name: "planning ahead, strong wind",
    wind: 20, from: 90, cur: 0.2, air: 70, water: 68, skyPct: 30,
    at: NOON, now: NOON - 2 * DAY,
    level: "warn",
    must: [/forecast has it blowing/i],
    mustNot: [/it is blowing/i, /out there today/i] },

  { name: "planning ahead, gale",
    wind: 30, from: 90, cur: 0.2, air: 70, water: 68, skyPct: 30,
    at: NOON, now: NOON - 2 * DAY,
    level: "stop",
    must: [/forecast has it really blowing/i],
    mustNot: [/it is really blowing/i] },

  { name: "planning ahead, wind against current",
    // a southerly runs into an ebb; 13 mph stays under the wind concern's
    // threshold, so with a hard enough current the chop line is the one that leads
    wind: 13, from: 180, cur: -1.7, air: 70, water: 68, skyPct: 30,
    at: NOON, now: NOON - 2 * DAY,
    level: "caution",
    must: [/forecast to run straight into the current/i],
    mustNot: [/\bis running straight into/i] },

  { name: "planning ahead, thunderstorms",
    wind: 7, from: 200, cur: 0.2, air: 80, water: 74, storm: 60, skyPct: 60,
    at: NOON, now: NOON - 2 * DAY,
    level: "warn",
    must: [/forecast around then/i],
    mustNot: [/next few hours/i] },

  { name: "planning ahead, cold water",
    wind: 7, from: 200, cur: 0.2, air: 66, water: 48, skyPct: 20,
    at: NOON, now: NOON - 2 * DAY,
    level: "caution",
    must: [/water is cold today/i],
    mustNot: [/water is still cold, despite/i] },

  // the river is the one thing we can promise; it just should not be phrased
  // as though the reader were standing on the bank
  { name: "planning ahead, the river still speaks with confidence",
    wind: 4, from: 180, cur: 0.05, air: 72, water: 70, skyPct: 5,
    at: NOON, now: NOON - 2 * DAY,
    level: "good",
    mustNot: [/right now/i] },

  // an alert that has expired by the time you are asking about
  { name: "planning ahead, advisory already expired",
    wind: 6, from: 180, cur: 0.2, air: 70, water: 68, skyPct: 30,
    alerts: [{event:"Wind Advisory", severity:"Moderate", ends: NOON - 6 * 3600e3}],
    at: NOON, now: NOON - 2 * DAY,
    level: "good",
    mustNot: [/advisory/i] },

  { name: "planning ahead, advisory still in effect",
    wind: 6, from: 180, cur: 0.2, air: 70, water: 68, skyPct: 30,
    alerts: [{event:"Wind Advisory", severity:"Moderate", ends: NOON + 6 * 3600e3}],
    at: NOON, now: NOON - 2 * DAY,
    level: "warn",
    must: [/wind advisory/i] },

  { name: "right now, rain",
    wind: 6, from: 180, cur: 0.2, air: 64, water: 66, skyPct: 95, wx: "rain",
    at: EVENING, now: EVENING,
    level: "caution",
    // the headline carries the light now, so the sentence does not repeat it
    must: [/it is mild and raining/i, /not much daylight left/i],
    mustNot: [/the forecast calls for/i, /sun will be going down/i, /sun is going down/i] },

  { name: "before sunrise",
    wind: 5, from: 180, cur: 0.2, air: 66, water: 68, at: T.fromNY(2026, 6, 15, 4, 0),
    level: "warn",
    must: [/dark/i] },

  { name: "thunderstorms brewing, 25%",
    wind: 7, from: 200, cur: 0.2, air: 80, water: 74, storm: 25,
    level: "caution",
    must: [/thunderstorm/i],
    mustNot: [/good day/i] },

  { name: "thunderstorms likely, 60%",
    wind: 7, from: 200, cur: 0.2, air: 80, water: 74, storm: 60,
    level: "warn",
    must: [/thunderstorm/i, /radar/i],
    // the page must not claim there is nowhere to land - there are places
    mustNot: [/nowhere to hide|no shelter/i, /likely/i] },

  { name: "no weather data at all",
    wind: null, cur: 0.6, air: null, water: null,
    level: "fine",          // not "good" - with no wind reading we cannot claim it
    // \b matters here: "window" contains "wind"
    mustNot: [/undefined|NaN|null/, /\bwind\b|\brain\b|\bcloud/i] }
];

/* ---------- properties ---------- */
console.log("SEVERITY, CONTENT AND COHERENCE\n");
for (const s of SCENARIOS){
  const b = run(s);
  const text = [b.head, b.body, b.safety && b.safety.html, b.ahead].filter(Boolean).join(" ");
  check(s.name, `level should be ${s.level}, got ${b.level}`, b.level === s.level, text.slice(0, 110));
  for (const re of s.must || [])
    check(s.name, `copy must mention ${re}`, re.test(text), text.slice(0, 140));
  for (const re of s.mustNot || [])
    check(s.name, `copy must NOT contain ${re}`, !re.test(text), text.slice(0, 140));
  const factsText = b.facts.map(f => f[0] + " " + f[1]).join(" | ");
  for (const re of s.factsMust || [])
    check(s.name, `the readings must show ${re}`, re.test(factsText), factsText);

  // A forecast must never be asserted as a reading. One property beats
  // remembering to hedge each sentence by hand.
  if (b.__in.t > b.__in.now + 30 * 60000)
    check(s.name, "a forecast is never phrased as a reading",
      !/\b(it is|the wind is running|there is thunder in the forecast for the next|right now)\b/i
        .test(text.replace(/it is going fast/gi, "")), text);

  // the summary is prose now; the numbers belong in the module
  check(s.name, "the summary carries no figures",
    !/\d+\s?(mph|\u00B0F|kt)\b/.test(b.body), b.body);
  check(s.name, "the summary stays short", b.body.length <= 260, `${b.body.length} chars`);
  // a dangling "It is running..." reads as nonsense after a sentence about water temp
  check(s.name, "no sentence starts with an unanchored It",
    !/(?:^|[.!?]\s)It is running/.test(b.body)
      || /wind|blowing/i.test(b.body.split(/It is running/)[0]), b.body);
  /* The summary must not repeat the instruction the safety line already
     carries, and carries again in the wetsuit sentence. Say it once. */
  /* Never describe the water as cold when it is not. The immersion advice
     trips on three different things and only one of them is the river. */
  if (b.__in.w && b.__in.w.waterF != null && b.__in.w.waterF >= 65)
    check(s.name, "warm water is never called cold",
      !/cold water|water is cold/i.test(text), `${b.__in.w.waterF}F / ${text.slice(0,90)}`);

  check(s.name, "the body does not repeat the immersion instruction",
    !/dress for the (water|immersion)/i.test(b.body), b.body);
  // and no sentence about the water may be followed by a bare "It"
  check(s.name, "nothing dangles after the water sentence",
    !/end up in it\.\s+It\b|whatever the air does\.\s+It\b/.test(b.body), b.body);

  // tidal jargon needs a plain-language gloss, or it should not appear at all
  check(s.name, "no unexplained tide jargon in the summary",
    !/\b(flood|ebb|flooding|ebbing)\b/i.test(b.body)
      || /running (north|south)|current/i.test(b.body), b.body);
  check(s.name, "the readings are present", b.facts.length >= 2, factsText);

  // coherence: the headline must speak for the verdict, not for a lesser worry
  const inp = b.__in;
  const heads = T.briefConcerns(inp.t, inp.cv, inp.w, T.skyFor(inp.t), inp.now)
    .concerns.filter(c => c.level === b.level).map(c => c.head);
  // either a concern at the verdict's own level speaks for it, or the verdict
  // speaks for itself - never a lesser worry
  /* A headline is the concern that speaks for the verdict, optionally followed
     by a second beat naming what that concern left out - the river under a wind
     warning, the air under a cold-water one. The first beat still has to be the
     verdict's own concern; a lesser worry may not lead. */
  const leads = h => b.head === h
    || (h && b.head.startsWith(h.replace(/\.$/, "") + ", ") && b.head.endsWith("."));
  check(s.name, `headline must speak for a ${b.level} verdict`,
    heads.some(leads) || leads(T.HEADLINE[b.level])
      // nothing flagged: one shape for every quiet day, whatever its verdict
      || (!heads.length && b.head === T.waterHead(inp.cv, inp.w)),
    `"${b.head}" vs [${heads.join(" | ")}] or "${T.HEADLINE[b.level]}"`);

  // The one that matters: "pleasant" is a promise, and an absence of hazards is
  // not a nice day. Checked on every scenario and every sweep, not just the ones
  // I thought to write.
  /* "glassy" is out of this list deliberately. It describes the surface of the
     river - very light air over water that is barely moving - and a cold
     morning can be glassy. The words below are verdicts on the whole day,
     which is a promise the page has no business making. */
  check(s.name, "only a genuinely pleasant day may be called one",
    !/\b(pleasant|beautiful|lovely|perfect)\b/i.test(b.head)
      || T.pleasantEnough(inp.w), `"${b.head}" / ${JSON.stringify(inp.w)}`);
  // but glassy still has to be true of the river: light air, and barely moving
  check(s.name, "glassy means the air is light too",
    !/glassy/i.test(b.head) || (inp.w && inp.w.windMph != null && inp.w.windMph < 5),
    `"${b.head}" / ${inp.w && inp.w.windMph} mph`);
  // and the page never grades the day, in either direction
  check(s.name, "the good-day headline describes rather than judges",
    b.level !== "good" || !/\b(pleasant|beautiful|lovely|perfect|great|nice)\b/i.test(b.head),
    b.head);
  // "calm and glassy" is a claim about the river, not just the air
  check(s.name, "glassy means the river is quiet too",
    !/glassy/i.test(b.head) || Math.abs(inp.cv) < 0.4, `"${b.head}" cur=${inp.cv}`);

  // cold water has its own floor: warm air must never mask it
  if (inp.w && inp.w.waterF != null && inp.w.waterF < 60){
    check(s.name, "water under 60F always raises the immersion advice",
      /wet or drysuit/i.test(b.safety.html), b.safety.html);
    check(s.name, "water under 60F is called cold water",
      /cold water/i.test(text), text.slice(0, 160));
  }

  // coherence: nothing at warn or worse may reassure, whatever raised it
  if (b.level === "stop" || b.level === "warn")
    check(s.name, `a ${b.level} verdict must not soften itself`,
      !/not dangerous|should stay smooth|bumpy ride|nothing much/i.test(text), text.slice(0,150));

  // numeracy: every mph figure quoted must be one the page actually computed
  // any mph in the prose is a wind figure now, and must be the real one
  const quoted = [...text.matchAll(/([\d.]+) mph/g)].map(m => parseFloat(m[1]));
  const allowed = [s.wind, s.gust, T.PADDLE_MPH].filter(v => v != null).map(v => +v.toFixed(1));
  const bogus = quoted.filter(q => !allowed.some(a => Math.abs(a - q) < 0.06));
  check(s.name, `every mph figure must be real (saw ${quoted.join(", ") || "none"})`,
    bogus.length === 0, bogus.length ? "unexplained: " + bogus.join(", ") : "");

  check(s.name, "no empty or stub copy", b.head.length > 8 && b.body.length > 25, text.slice(0,80));
  check(s.name, "no unrendered values", !/undefined|NaN|\[object/.test(text), text.slice(0,140));
  for (const re of NEVER)
    check(s.name, `must never reassure: ${re}`, !re.test(text), text.slice(0,140));
  // the one-line note must never plan a trip on a day we said not to go
  if (b.level === "stop")
    check(s.name, "a stop verdict offers no trip planning", !b.note,
      b.note || "");
  // and when it does speak, it must name a real direction
  if (b.note)
    check(s.name, "the speed note names a direction or says it is slow both ways",
      /north|south|east|west|whichever way/.test(b.note), b.note);

  // the two-direction outlook: always both, always in the same shape
  for (const dir of ["up", "down"]){
    const o = b.outlook[dir];
    check(s.name, `${dir} outlook exists with wind and current`, o && o.lines.length >= 1,
      JSON.stringify(o && o.lines));
    check(s.name, `${dir} speed matches the module`, o.speed === b.speeds[dir]);
    check(s.name, `${dir} outlook has no stub text`,
      o.lines.every(l => l.length > 8 && !/undefined|NaN|null/.test(l)), JSON.stringify(o.lines));
  }
  {
    const n = b.outlook.up.lines.join(" | "), so = b.outlook.down.lines.join(" | ");
    // a headwind one way is a tailwind the other - never both faces, never both backs
    check(s.name, "wind cannot be in your face both ways",
      !(/in your face/.test(n) && /in your face/.test(so)), n + " // " + so);
    check(s.name, "wind cannot be at your back both ways",
      !(/at your back/.test(n) && /at your back/.test(so)), n + " // " + so);
    // likewise the current
    check(s.name, "current cannot help both ways",
      !(/helping|real push/.test(n) && /helping|real push/.test(so)), n + " // " + so);
    // chop is a property of the river, so it is either there or it is not
    check(s.name, "chop appears in both directions or neither",
      /Choppy/.test(n) === /Choppy/.test(so), n + " // " + so);
  }

  // speeds live in their own module now, always present and always numbers
  check(s.name, "speeds are finite numbers",
    Number.isFinite(b.speeds.up) && Number.isFinite(b.speeds.down),
    JSON.stringify(b.speeds));
  check(s.name, "speeds are plausible for a kayak",
    b.speeds.up < 9 && b.speeds.down < 9 && b.speeds.up > -3 && b.speeds.down > -3,
    JSON.stringify(b.speeds));
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

  let stormOK = true, stormDetail = "";
  for (const storm of [0,10,19,20,35,49,50,70,90]){
    const b = run({wind:6, from:0, cur:0.2, air:74, water:72, storm, name:"storm sweep"});
    const want = storm >= 50 ? "warn" : storm >= 20 ? "caution" : "good";
    if (T.LEVELS.indexOf(b.level) > T.LEVELS.indexOf(want)){
      stormOK = false; stormDetail = `${storm}% thunder gave ${b.level}, expected ${want} or worse`;
    }
  }
  check("thunder sweep 0 -> 90%", "rising thunder chance must not give a friendlier verdict", stormOK, stormDetail);

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
