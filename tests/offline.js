/* Pure-logic tests. No network. Run: node tests/offline.js */
const {load} = require("./harness.js");
const {T} = load();
const MIN = 60000, HOUR = 3600000;

let pass = 0, fail = 0;
const fmt = ms => new Intl.DateTimeFormat("en-GB",
  {dateStyle:"short", timeStyle:"short", hour12:false, timeZone:"America/New_York"}).format(ms);
function ok(name, cond, detail){
  if (cond){ pass++; }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n        " + detail : "")); }
}
function eq(name, got, want){ ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function group(n){ console.log("\n" + n); }

/* ---------- time and DST ---------- */
group("Time zones and DST");
{
  // 2026: spring forward Mar 8, fall back Nov 1
  const p = T.nyParts(T.fromNY(2026, 7, 4, 14, 30));
  ok("round-trip midsummer", p.y===2026 && p.mo===7 && p.d===4 && p.h===14 && p.mi===30, JSON.stringify(p));
  const w = T.nyParts(T.fromNY(2026, 1, 15, 9, 5));
  ok("round-trip midwinter", w.y===2026 && w.mo===1 && w.d===15 && w.h===9 && w.mi===5, JSON.stringify(w));

  // an hour either side of each transition must round-trip
  for (const [mo, d, h] of [[3,8,1],[3,8,4],[11,1,0],[11,1,3]]){
    const q = T.nyParts(T.fromNY(2026, mo, d, h, 0));
    ok(`round-trip near DST ${mo}/${d} ${h}:00`, q.h === h && q.d === d, JSON.stringify(q));
  }
  // EST and EDT really are an hour apart
  const jan = T.fromNY(2026,1,15,12,0), jul = T.fromNY(2026,7,15,12,0);
  const offJan = (Date.UTC(2026,0,15,12,0) - jan) / HOUR, offJul = (Date.UTC(2026,6,15,12,0) - jul) / HOUR;
  eq("January offset is UTC-5", offJan, -5);
  eq("July offset is UTC-4", offJul, -4);

  for (const [mo,d] of [[7,4],[1,15],[3,8],[11,1]]){
    const s = T.nyParts(T.dayStartNY(T.fromNY(2026, mo, d, 15, 0)));
    ok(`dayStartNY is local midnight ${mo}/${d}`, s.h===0 && s.mi===0 && s.d===d, JSON.stringify(s));
  }
  // the charts span t0 + 24h; on DST days the local day is 23 or 25 hours
  for (const [mo,d,len] of [[3,8,23],[11,1,25],[7,4,24]]){
    const t0 = T.dayStartNY(T.fromNY(2026, mo, d, 12, 0));
    const t1 = T.dayStartNY(T.fromNY(2026, mo, d+1, 12, 0));
    eq(`local day length ${mo}/${d} is ${len}h`, (t1-t0)/HOUR, len);
    // the charts must span the real local day, not a fixed 24 hours
    eq(`chart span matches ${mo}/${d}`, (T.dayStartNY(t0 + 36*HOUR) - t0)/HOUR, len);
  }
}

/* ---------- baked prediction data ---------- */
group("Prediction data integrity");
{
  eq("tide count", T.TIDE.length, 4236);
  eq("current count", T.CUR.length, 8471);
  let mono = true, alt = true;
  for (let i = 1; i < T.TIDE.length; i++){
    if (T.TIDE[i].t <= T.TIDE[i-1].t) mono = false;
    if (T.TIDE[i].type === T.TIDE[i-1].type) alt = false;
  }
  ok("tide times strictly increasing", mono);
  ok("tide types alternate high/low", alt);
  let cmono = true;
  for (let i = 1; i < T.CUR.length; i++) if (T.CUR[i].t <= T.CUR[i-1].t) cmono = false;
  ok("current times strictly increasing", cmono);
  ok("highs + lows == all tides", T.HIGHS.length + T.LOWS.length === T.TIDE.length);
  ok("data starts in 2026", T.nyParts(T.RANGE[0]).y === 2026, fmt(T.RANGE[0]));
  ok("data ends in 2028", T.nyParts(T.RANGE[1]).y === 2028, fmt(T.RANGE[1]));
  // tide heights are plausible for the Hudson at Cold Spring
  const hs = T.HIGHS.map(p=>p.v), ls = T.LOWS.map(p=>p.v);
  ok("high tides 2-5 ft", Math.min(...hs) > 1.5 && Math.max(...hs) < 5.5, `${Math.min(...hs)}..${Math.max(...hs)}`);
  ok("low tides -1..1.5 ft", Math.min(...ls) > -1.5 && Math.max(...ls) < 1.5, `${Math.min(...ls)}..${Math.max(...ls)}`);
  ok("max current under 2.5 kt", Math.max(...T.CUR.map(p=>Math.abs(p.v))) < 2.5);
}

/* ---------- the two shifts ---------- */
group("Station shifts");
{
  eq("tide shifted 30 min earlier", T.TIDE_SHIFT_MIN, -30);
  eq("current unshifted", T.CUR_SHIFT_MIN, 0);
}

/* ---------- interpolation shape ---------- */
group("Interpolation");
{
  const a = T.TIDE[100], b = T.TIDE[101];
  ok("tide hits its endpoints", Math.abs(T.tideAt(a.t) - a.v) < 0.01 && Math.abs(T.tideAt(b.t) - b.v) < 0.01);
  const mid = T.tideAt((a.t + b.t) / 2);
  ok("tide midpoint between extremes", mid > Math.min(a.v,b.v) && mid < Math.max(a.v,b.v));
  // current: quarter-sine from slack, so the midpoint is ~0.707 of max, not 0.5
  const si = T.CUR.findIndex((p,i) => i>0 && p.type!=="slack" && T.CUR[i-1].type==="slack");
  const s0 = T.CUR[si-1], m0 = T.CUR[si];
  const half = Math.abs(T.curAt((s0.t + m0.t)/2) / m0.v);
  ok("current midpoint ~0.707 of max (quarter-sine)", Math.abs(half - 0.7071) < 0.02, `got ${half.toFixed(4)}`);
  ok("tideAt outside range is null", T.tideAt(T.RANGE[0] - 10*24*HOUR) === null);
}

/* ---------- marsh access ---------- */
group("Marsh access windows");
{
  const h = T.HIGHS[500], l = T.LOWS[500];
  ok("blocked at high tide", T.blockedAt(h.t));
  ok("blocked 119 min before high", T.blockedAt(h.t - 119*MIN));
  ok("blocked 119 min after high", T.blockedAt(h.t + 119*MIN));
  ok("clear 121 min before high", !T.blockedAt(h.t - 121*MIN));
  ok("clear 121 min after high", !T.blockedAt(h.t + 121*MIN));
  ok("mud at low tide", T.muddyAt(l.t));
  ok("mud 119 min either side of low", T.muddyAt(l.t - 119*MIN) && T.muddyAt(l.t + 119*MIN));
  ok("no mud 121 min either side of low", !T.muddyAt(l.t - 121*MIN) && !T.muddyAt(l.t + 121*MIN));
  eq("trestle window is 2h", T.TRESTLE_MIN, 120);
  eq("mud window is 2h", T.MUD_MIN, 120);

  // the two must never overlap, or the page cannot say which applies
  let both = 0, open = 0, samples = 0;
  for (let t = T.RANGE[0] + HOUR; t < T.RANGE[0] + 365*24*HOUR; t += 7*MIN){
    samples++;
    const b = T.blockedAt(t), m = T.muddyAt(t);
    if (b && m) both++;
    if (!b && !m) open++;
  }
  eq("blocked and muddy never coincide (1 year)", both, 0);
  ok("access windows exist ~35% of the time", open/samples > 0.25 && open/samples < 0.45,
     `${(100*open/samples).toFixed(1)}%`);
}

/* ---------- wind vs current ---------- */
group("Wind relative to current");
{
  // flood runs toward 10 deg, ebb toward 190
  eq("flood + wind from S = aligned",  T.windVsCurrent(190, 1), "aligned");
  eq("flood + wind from N = opposed",  T.windVsCurrent(10, 1),  "opposed");
  eq("flood + wind from E = across",   T.windVsCurrent(100, 1), "across");
  eq("flood + wind from W = across",   T.windVsCurrent(280, 1), "across");
  eq("ebb + wind from N = aligned",    T.windVsCurrent(10, -1), "aligned");
  eq("ebb + wind from S = opposed",    T.windVsCurrent(190, -1),"opposed");
  eq("slack water reported as slack",  T.windVsCurrent(10, 0.05), "slack");
  // boundaries are 60 and 120 degrees from the current's heading
  eq("59 deg off = aligned", T.windVsCurrent((190 + 59) % 360, 1), "aligned");
  eq("61 deg off = across",  T.windVsCurrent((190 + 61) % 360, 1), "across");
  eq("121 deg off = opposed", T.windVsCurrent((190 + 121) % 360, 1), "opposed");

  const b = T.windCurrentBand({windMph:12, windGustMph:18, windFromDeg:10}, 1);
  ok("flood: faster north than south", b.text.includes("4.2 mph heading north") && b.text.includes("1.8 mph heading south"), b.text);
  ok("north is named first", b.text.indexOf("heading north") < b.text.indexOf("heading south"));
  ok("opposed wind is called out", b.text.includes("blowing against the current"));
  const e = T.windCurrentBand({windMph:12, windGustMph:18, windFromDeg:10}, -1);
  ok("ebb: faster south than north", e.text.includes("4.2 mph heading south") && e.text.includes("1.8 mph heading north"), e.text);
  const calm = T.windCurrentBand({windMph:3, windGustMph:5, windFromDeg:10}, 1);
  ok("light wind defers to the current", calm.text.includes("wind is light"), calm.text);
  ok("no wind data still gives speeds", T.windCurrentBand(null, 1).text.includes("heading north"));
  ok("slack and calm says nothing at all", T.windCurrentBand({windMph:2, windGustMph:3, windFromDeg:10}, 0) === null);
  ok("slack but windy still warns about the wind",
     (T.windCurrentBand({windMph:15, windGustMph:22, windFromDeg:10}, 0)||{}).text.includes("slack"));
  eq("paddling pace", T.PADDLE_MPH, 3);
}

/* ---------- immersion, the 120 rule ---------- */
group("Immersion advice");
{
  const u = (a,w) => T.immersionLede(a,w).urgent;
  ok("135 total: no warning", !u(75,60));
  ok("121 total: no warning", !u(71,50));
  ok("120 total: warns",      u(70,50));
  ok("water 45 despite 125 total: warns", u(80,45));
  ok("air 45 despite 125 total: warns",   u(45,80));
  ok("missing readings: no warning",      !u(null,60) && !u(70,null));
  ok("always says dress for immersion",   T.immersionLede(80,75).html.includes("Always dress for immersion"));
  ok("warning names the combined figure", T.immersionLede(61,52).html.includes("113"));
  eq("water word: 49F", T.waterWord(49), "Dangerously cold");
  eq("water word: 55F", T.waterWord(55), "Cold");
  eq("water word: 65F", T.waterWord(65), "Cool");
  eq("water word: 75F", T.waterWord(75), "Mild");
}

/* ---------- small helpers ---------- */
group("Formatting and parsing");
{
  eq("compass N",  T.compass(0), "N");
  eq("compass E",  T.compass(90), "E");
  eq("compass S",  T.compass(180), "S");
  eq("compass W",  T.compass(270), "W");
  eq("compass NW", T.compass(315), "NW");
  eq("compass wraps", T.compass(350), "N");
  eq("dur 45m", T.dur(45*MIN), "45m");
  eq("dur 1h",  T.dur(60*MIN), "1h 00m");
  eq("dur 2h05", T.dur(125*MIN), "2h 05m");
  eq("iso PT1H", T.isoDurMs("PT1H"), HOUR);
  eq("iso PT6H", T.isoDurMs("PT6H"), 6*HOUR);
  eq("iso P1DT2H", T.isoDurMs("P1DT2H"), 26*HOUR);
  eq("sky 0%", T.skyWord(0), "Clear");
  eq("sky 50%", T.skyWord(50), "Partly cloudy");
  eq("sky 100%", T.skyWord(100), "Overcast");
  const g = {temperature:{values:[{validTime:"2026-09-24T12:00:00+00:00/PT3H", value:17}]}};
  eq("valueAt inside interval", T.valueAt(g.temperature, Date.parse("2026-09-24T14:00:00Z")), 17);
  eq("valueAt outside interval", T.valueAt(g.temperature, Date.parse("2026-09-24T16:00:00Z")), null);
  eq("valueAt with no series", T.valueAt(null, Date.now()), null);
  eq("conditionsAt with no grid", T.conditionsAt(Date.now()), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
