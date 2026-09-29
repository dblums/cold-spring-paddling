/* Pure-logic tests. No network. Run: node tests/offline.js */
const {load, sites, pageFor, pageSlug} = require("./harness.js");
const fs = require("fs");
const ALL = sites();
const ALL_WATER = ["The Battery", "Turkey Point", "Coxsackie"];
const {T} = load();          // the root site, for the bulk of the assertions
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

  /* The module reports clearance under a bridge, which the tide prediction
     actually tells us. Whether a given paddler should go through it does not
     follow from a tide table, so the page must not say so. */
  // the copy lives in two places: the card markup and the render logic below it
  const built = fs.readFileSync(pageFor(ALL.find(x => x.primary)), "utf8");
  const marshSrc = built.split("Constitution Marsh")[1].split("Sun &amp; Moon")[0]
    + built.split('$("crossCell")')[1].split('$("summaryText")')[0];
  ok("the marsh slice actually found the render logic",
     marshSrc.includes("crossVerdict") && marshSrc.includes("summary ="));
  ok("the trestle module never rules on safety",
     !/\b(safe|unsafe|safely|dangerous)\b/i.test(marshSrc),
     (marshSrc.match(/.{0,60}\b(safe|unsafe|safely|dangerous)\b.{0,60}/i) || [""])[0]);
  ok("the trestle module speaks in clearance", /enough clearance/i.test(marshSrc));
  ok("the trestle module hedges the positive case", /likely enough clearance/i.test(marshSrc));
  ok("access windows exist ~35% of the time", open/samples > 0.25 && open/samples < 0.45,
     `${(100*open/samples).toFixed(1)}%`);
}

/* ---------- wind vs current ---------- */
group("Wind relative to current");
{
  /* Relative to the river's own axis, not a hardcoded 10/190. These used to
     assume the Hudson runs north-south, which it does not at every launch -
     and they failed honestly the moment Cold Spring's axis was corrected. */
  const FLOOD = T.SITE.floodToward, EBB = T.SITE.ebbToward;
  const deg = d => ((d % 360) + 360) % 360;
  // a wind blows FROM one way and TOWARD the other, so "from EBB" pushes with a flood
  eq("flood + wind with it = aligned",   T.windVsCurrent(deg(EBB), 1), "aligned");
  eq("flood + wind against it = opposed", T.windVsCurrent(deg(FLOOD), 1), "opposed");
  eq("flood + wind off one beam = across",  T.windVsCurrent(deg(FLOOD + 90), 1), "across");
  eq("flood + wind off the other = across", T.windVsCurrent(deg(FLOOD - 90), 1), "across");
  eq("ebb + wind with it = aligned",     T.windVsCurrent(deg(FLOOD), -1), "aligned");
  eq("ebb + wind against it = opposed",  T.windVsCurrent(deg(EBB), -1), "opposed");
  eq("slack water reported as slack",    T.windVsCurrent(deg(FLOOD), 0.05), "slack");
  // boundaries are 60 and 120 degrees from the current's heading
  eq("59 deg off = aligned",  T.windVsCurrent(deg(EBB + 59), 1), "aligned");
  eq("61 deg off = across",   T.windVsCurrent(deg(EBB + 61), 1), "across");
  eq("121 deg off = opposed", T.windVsCurrent(deg(EBB + 121), 1), "opposed");
  // and the pair must actually be a pair
  ok("flood and ebb are opposite within 30 deg",
     Math.abs(((FLOOD - EBB) % 360 + 360) % 360 - 180) < 30, `${FLOOD} vs ${EBB}`);

  // the speed sentence now lives in the summary at the top of the page
  const brief = (cv, wind) => T.buildBrief(T.fromNY(2026, 6, 15, 12, 0), cv,
    {windMph:wind.mph, windGustMph:wind.mph + 6, windFromDeg:wind.from, airF:72, waterF:70, stormPct:0},
    T.skyFor(T.fromNY(2026, 6, 15, 12, 0)));
  const bf = brief(1, {mph:12, from:T.SITE.floodToward});
  ok("flood: faster north than south", bf.speeds.up > bf.speeds.down,
     `${bf.speeds.up.toFixed(2)} vs ${bf.speeds.down.toFixed(2)}`);
  ok("the summary never buries the speeds in prose", !/mph going (north|south)/.test(bf.body), bf.body);
  const be = brief(-1, {mph:12, from:10});
  ok("ebb: faster south than north", be.speeds.down > be.speeds.up,
     `${be.speeds.down.toFixed(2)} vs ${be.speeds.up.toFixed(2)}`);

  // the model itself, which those sentences are reporting
  eq("still air, slack water is the baseline", +T.groundSpeedMph(0, 0).toFixed(2), 3);
  ok("a pure crosswind barely slows you", Math.abs(T.groundSpeedMph(0, T.headwindMph(90, 20, 0)) - 3) < 0.05);
  ok("25 mph headwind leaves under 1 mph", T.groundSpeedMph(0, 25) < 1.0);
  ok("25 mph headwind plus adverse current loses ground", T.groundSpeedMph(-1, 25) <= 0);
  // drag goes with the square of airspeed, so a headwind takes more than the
  // same tailwind gives - 1.2 mph lost against 0.7 gained, at 15 mph
  ok("a headwind costs more than the same tailwind gives",
     T.groundSpeedMph(0, -15) - 3 < 3 - T.groundSpeedMph(0, 15));
  // with no weather at all the summary still reports what the current will do
  const noWx = T.buildBrief(T.fromNY(2026, 6, 15, 12, 0), 1, null,
    T.skyFor(T.fromNY(2026, 6, 15, 12, 0)));
  ok("no wind data still gives speeds",
     Number.isFinite(noWx.speeds.up) && Number.isFinite(noWx.speeds.down), JSON.stringify(noWx.speeds));
  ok("no wind data invents no weather", !/wind|rain|cloud/i.test(noWx.body), noWx.body);
  eq("paddling pace", T.PADDLE_MPH, 3);
}

/* ---------- immersion, the 120 rule ---------- */
group("Immersion advice");
{
  const u = (a,w) => T.immersionLede(a,w).urgent;
  ok("135 total over 60F water: no warning", !u(75,60));
  ok("121 total over 60F water: no warning", !u(61,60));
  ok("120 total: warns",      u(70,50));
  ok("water 45 despite 125 total: warns", u(80,45));
  ok("air 45 despite 125 total: warns",   u(45,80));
  // the floor: warm air must never mask cold water, whatever the sum says
  ok("59F water warns even at 130 total",  u(71,59));
  ok("52F water warns at 124 total",       u(72,52));   // the May trap
  ok("60F water is the boundary, not warm side", !u(75,60) && u(75,59));
  ok("missing readings: no warning",      !u(null,60) && !u(70,null));
  ok("always says life jacket and immersion", T.immersionLede(80,75).html.includes("life jacket") && T.immersionLede(80,75).html.includes("dress for immersion"));
  ok("no wetsuit line on a warm day",     !T.immersionLede(80,75).html.includes("drysuit"));
  ok("wetsuit line when the rule trips",  T.immersionLede(61,52).html.includes("wet or drysuit"));
  // the reason given must be the one that actually applies
  ok("cold water names the water figure", T.immersionLede(72,52).html.includes("only 52"));
  ok("cold water does not cite the sum",  !T.immersionLede(72,52).html.includes("combined"));
  ok("combined rule names the sum",       T.immersionLede(58,62).html.includes("120"));
  ok("combined rule flagged as not cold", !T.immersionLede(58,62).cold);
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

/* ---------- every launch site builds and behaves ---------- */
group("All launch sites");
for (const site of ALL){
  const {T: S} = load(site);
  const html = fs.readFileSync(pageFor(site), "utf8");
  ok(`${site.name}: no unfilled placeholders`, !/\{\{\w+\}\}/.test(html));
  // a photo inlined as base64 has to be parsed before anything below it renders,
  // so the deployed page links its photo instead. Guard against it creeping back.
  ok(`${site.name}: page carries no inlined image`, !/src="data:image/.test(html),
     `${Math.round(html.length/1024)} KB`);
  ok(`${site.name}: page under 200 KB`, html.length < 200*1024, `${Math.round(html.length/1024)} KB`);
  if (site.banner) ok(`${site.name}: banner shipped as a file`,
     fs.existsSync(pageFor(site).replace(/index\.html$/, "banner.jpg")));
  const title = (/<title>([^<]*)<\/title>/.exec(html) || [])[1];
  eq(`${site.name}: page title`, title, site.title);
  ok(`${site.name}: title names this launch`, (title||"").includes(site.name));
  // a launch's own identity must never show another launch's name
  const heading = (/<h1[^>]*>([^<]*)<\/h1>/.exec(html) || [])[1] || "";
  ok(`${site.name}: headline names this launch`, heading.includes(site.name), heading);
  /* A launch must not wear another launch's name - but one of them is called
     Hudson, and every title begins "Hudson River Paddling Conditions". Check
     the part that actually identifies the page rather than the whole string. */
  const named = t => (/Near ([^,]+),/.exec(t || "") || [])[1] || "";
  eq(`${site.name}: headline names this launch`, named(heading), site.name);
  eq(`${site.name}: title names this launch`, named(title), site.name);
  for (const other of ALL) if (other.slug !== site.slug){
    ok(`${site.name}: headline does not say ${other.name}`, named(heading) !== other.name, heading);
    ok(`${site.name}: title does not say ${other.name}`, named(title) !== other.name);
  }
  ok(`${site.name}: site config matches locations/`,
     S.SITE.slug === site.slug && S.SITE.lat === site.lat && S.SITE.riverMile === site.riverMile);
  eq(`${site.name}: tide shift`, S.TIDE_SHIFT_MIN, site.tide.shiftMin);
  eq(`${site.name}: NWS grid`, S.SITE.nwsGrid, site.nws.grid);
  ok(`${site.name}: page names its own NWS office`,
     html.includes("NWS " + site.nws.grid.split("/")[0]));
  ok(`${site.name}: shows its own station labels`,
     html.includes(site.tide.label) && html.includes(site.current.label));
  eq(`${site.name}: current shift`, S.CUR_SHIFT_MIN, site.current.shiftMin);
  ok(`${site.name}: has three years of tides`, S.TIDE.length > 4000 && S.TIDE.length < 4500);
  ok(`${site.name}: has three years of currents`, S.CUR.length > 8000 && S.CUR.length < 9000);
  ok(`${site.name}: tide alternates high/low`,
     S.TIDE.every((p,i) => i===0 || p.type !== S.TIDE[i-1].type));
  ok(`${site.name}: flood and ebb headings are roughly opposite`,
     Math.abs((((site.current.floodToward - site.current.ebbToward) % 360) + 360) % 360 - 180) < 30,
     `${site.current.floodToward} vs ${site.current.ebbToward}`);
  ok(`${site.name}: astronomy uses its own coordinates`,
     Math.abs(S.skyFor(Date.now()).sunset - T.skyFor(Date.now()).sunset) < 20*60000);
  // the marsh card belongs to Cold Spring only
  const hasMarsh = (site.features || []).includes("marsh");
  eq(`${site.name}: marsh card ${hasMarsh ? "present" : "absent"}`,
     /id="gate"/.test(html), hasMarsh);
  eq(`${site.name}: marsh logic ${hasMarsh ? "present" : "absent"}`,
     /Constitution Marsh/.test(html), hasMarsh);
  eq(`${site.name}: marsh helpers ${hasMarsh ? "present" : "absent"}`, S.blockedAt !== undefined, hasMarsh);
  eq(`${site.name}: trestle constant ${hasMarsh ? "present" : "absent"}`, S.TRESTLE_MIN !== undefined, hasMarsh);
  /* Every station reference on a page must be THIS launch's station. The tide
     link was hardcoded to 8518934 and so pointed Hudson readers at Beacon. */
  const tideLink = (/stationhome\.html\?id=(\d+)/.exec(html) || [])[1];
  const curLink = (/noaacurrents\/predictions\.html\?id=([A-Z0-9_]+)/.exec(html) || [])[1];
  eq(`${site.name}: tide link points at its own station`, tideLink, site.tide.station);
  eq(`${site.name}: current link points at its own station`, curLink,
     `${site.current.station}_${site.current.bin}`);
  ok(`${site.name}: no other launch's tide station appears`,
     !ALL.some(o => o.slug !== site.slug && o.tide.station !== site.tide.station
                    && html.includes(o.tide.station)));

  /* Anything leaving the site opens in a new tab, so a reader checking a NOAA
     station does not lose the conditions they were reading. */
  const ext = [...html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g)];
  ok(`${site.name}: has external links to check`, ext.length >= 3, `${ext.length}`);
  for (const m of ext){
    const tag = m[0];
    ok(`${site.name}: ${m[1].slice(0, 46)} opens in a new tab`,
       /target="_blank"/.test(tag), tag.slice(0, 120));
    ok(`${site.name}: ${m[1].slice(0, 46)} is noopener`,
       /rel="noopener"/.test(tag), tag.slice(0, 120));
  }

  /* Water temperature is interpolated between the two NOAA stations bracketing
     the launch. Those used to be global constants picked for Cold Spring, so
     Hudson - north of Turkey Point - clamped to a single reading while the
     footer told readers Turkey Point was UPriver of them. It is downriver. */
  const ws = /const WATER_S = ({[^}]*}|null)/.exec(html)[1];
  const wn = /const WATER_N = ({[^}]*}|null)/.exec(html)[1];
  const wSouth = ws === "null" ? null : JSON.parse(ws);
  const wNorth = wn === "null" ? null : JSON.parse(wn);
  ok(`${site.name}: has a water station downriver or is at the mouth`,
     wSouth === null || wSouth.mile <= site.riverMile, `${wSouth && wSouth.mile} vs ${site.riverMile}`);
  ok(`${site.name}: has a water station upriver or is at the head`,
     wNorth === null || wNorth.mile > site.riverMile, `${wNorth && wNorth.mile} vs ${site.riverMile}`);
  if (wSouth && wNorth){
    ok(`${site.name}: the launch sits between its two water stations`,
       wSouth.mile <= site.riverMile && site.riverMile <= wNorth.mile,
       `${wSouth.mile} <= ${site.riverMile} <= ${wNorth.mile}`);
    // the footer must name the stations it actually uses, on the correct sides
    const note = (/Water temperature[^<]*/.exec(html) || [""])[0];
    ok(`${site.name}: the note names its downriver station`,
       new RegExp(wSouth.name + ", downriver").test(note), note.slice(0, 130));
    ok(`${site.name}: the note names its upriver station`,
       new RegExp(wNorth.name + ", up").test(note), note.slice(0, 130));
    ok(`${site.name}: the note names no other station`,
       !ALL_WATER.some(w => w !== wSouth.name && w !== wNorth.name && note.includes(w)), note.slice(0, 130));
  }

  // cross-links to the other launches
  for (const other of ALL) if (other.slug !== site.slug)
    ok(`${site.name}: links to ${other.name}`, html.includes(">" + other.name + "</a>"));
}
ok("more than one launch site is configured", ALL.length > 1, `${ALL.length}`);

/* ---------- URL structure ---------- */
group("URL structure");
{
  const path = require("path");
  const root = path.join(__dirname, "..");
  const slugs = ALL.map(pageSlug);

  ok("every launch slug carries its state", slugs.every(s => /-[a-z-]+$/.test(s)), slugs.join(" "));
  eq("launch slugs are unique", new Set(slugs).size, slugs.length);
  for (const site of ALL){
    const f = pageSlug(site) + ".html";
    ok(`${site.name}: served at /${f}`, fs.existsSync(path.join(root, f)));
  }

  // the bare domain serves the primary launch, byte for byte
  const primary = ALL.find(s => s.primary);
  const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const own = fs.readFileSync(pageFor(primary), "utf8");
  ok("the root serves the primary launch", idx === own, `${idx.length} vs ${own.length} bytes`);

  // ...and both copies point at the same canonical, so the duplicate is declared
  const canon = h => (h.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  eq("the root canonical is the launch's own URL",
     canon(idx), `https://hudsonconditions.com/${pageSlug(primary)}.html`);
  for (const site of ALL)
    eq(`${site.name}: canonical is its own URL`, canon(fs.readFileSync(pageFor(site), "utf8")),
       `https://hudsonconditions.com/${pageSlug(site)}.html`);

  ok("no launches page is deployed", !fs.existsSync(path.join(root, "launches.html")));

  /* The tip module is all-or-nothing: a configured link means a complete
     module, and no link means no module at all rather than a dead button. */
  const cfg = fs.readFileSync(path.join(__dirname, "..", "scripts", "locations.py"), "utf8");
  const tipUrl = (cfg.match(/^TIP_URL = "([^"]*)"/m) || [])[1];
  const photo = (cfg.match(/^TIP_PHOTO = "([^"]*)"/m) || [])[1];
  for (const site of ALL){
    const html = fs.readFileSync(pageFor(site), "utf8");
    if (tipUrl){
      ok(`${site.name}: the tip module is present`, html.includes('<section class="tip">'));
      ok(`${site.name}: the tip button points at the link`, html.includes(`href="${tipUrl}"`));
      ok(`${site.name}: the tip link opens safely`, /class="tip"[\s\S]{0,600}rel="noopener"/.test(html));
      ok(`${site.name}: the tip module sits above Sun & Moon`,
         html.indexOf('<section class="tip">') < html.indexOf('id="skyCard"'));
      ok(`${site.name}: no placeholder link is deployed`, !/PLACEHOLDER|example\.com/i.test(tipUrl), tipUrl);
      if (photo){
        ok(`${site.name}: the tip photo is linked`, html.includes(`src="${photo}"`));
        ok(`${site.name}: the tip photo is sized and described`,
           /<img src="[^"]*" alt="[^"]{20,}" width="\d+" height="\d+" loading="lazy"/.test(html));
      }
    } else {
      ok(`${site.name}: no tip module without a link`, !html.includes('<section class="tip">'));
    }
  }
  if (tipUrl && photo){
    const f = path.join(root, photo);
    ok("the tip photo is written to the root", fs.existsSync(f));
    if (fs.existsSync(f))
      ok("the tip photo stays small", fs.statSync(f).size < 60 * 1024,
         `${Math.round(fs.statSync(f).size / 1024)} KB`);
  }
  if (!tipUrl && photo)
    ok("no orphan tip photo is deployed", !fs.existsSync(path.join(root, photo)));

  /* Where Stripe returns people after they pay. */
  const thanksPath = path.join(root, "thanks.html");
  if (tipUrl){
    ok("a thank-you page is built", fs.existsSync(thanksPath));
    const th = fs.readFileSync(thanksPath, "utf8");
    // a post-payment page has nothing to offer a search result
    ok("the thank-you page is noindex", /<meta name="robots" content="noindex">/.test(th));
    // one link home rather than a list that grows with every launch
    ok("the thank-you page links home", th.includes('href="/"'));
    ok("the thank-you page does not list launches",
       !ALL.some(x => th.includes(`href="${pageSlug(x)}.html"`)));
    ok("the thank-you page shares the site's colours", th.includes("--river:"));
  } else {
    ok("no thank-you page without a tip link", !fs.existsSync(thanksPath));
  }

  /* The feedback address is a forwarding alias, but it should still not sit in
     the page source in one piece for a harvester to lift. */
  for (const site of ALL){
    const html = fs.readFileSync(pageFor(site), "utf8");
    ok(`${site.name}: no plain address in the source`,
       !/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(html),
       (html.match(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [""])[0]);
    ok(`${site.name}: no mailto in the source`, !/mailto:[a-z]/i.test(html));
    ok(`${site.name}: the feedback link carries its parts`,
       /data-u="[a-z]+"\s+data-d="[a-z.]+"/.test(html));
    ok(`${site.name}: credits the owner`, html.includes("Modern Product Minds LLC"));
    ok(`${site.name}: carries a copyright year`, /&copy; 20\d\d/.test(html));
  }
  // the credit is about the site, so every launch carries it, banner or not
  for (const site of ALL){
    const html = fs.readFileSync(pageFor(site), "utf8");
    ok(`${site.name}: credits Dan for the site and photos`,
       html.includes("Site and photos by Dan Blumberg."));
    ok(`${site.name}: invites mail`, /Feedback\? .*Email me:/.test(html));
  }

  // flat files share one directory, so these cannot collide
  const banners = ALL.filter(s => s.banner).map(s => pageSlug(s) + ".jpg");
  eq("banner filenames are unique", new Set(banners).size, banners.length);
  for (const b of banners) ok(`${b} was written`, fs.existsSync(path.join(root, b)));

  // build byproducts must not be served
  ok("no stray banner.jpg at the root", !fs.existsSync(path.join(root, "banner.jpg")));
  ok("no artifact.html in the deployed root", !fs.existsSync(path.join(root, "artifact.html")));
  ok("artifacts live outside the site", fs.existsSync(path.join(root, "artifacts")));
  for (const site of ALL)
    ok(`${site.name}: artifact written to artifacts/`,
       fs.existsSync(path.join(root, "artifacts", site.slug + ".html")));

  // each page points at its own photo, not a shared name
  for (const site of ALL.filter(s => s.banner)){
    const html = fs.readFileSync(pageFor(site), "utf8");
    ok(`${site.name}: links its own banner`, html.includes(`src="${pageSlug(site)}.jpg"`));
  }
}

/* The file GitHub Pages reads to know which name to serve the site at. It is
   the whole reason hudsonconditions.com resolves to this repo, and it lives in
   a directory that is otherwise all build output - so assert the build wrote
   it, rather than trusting that nobody cleaned it away. */
{
  const path = require("path");
  const cnamePath = path.join(__dirname, "..", "CNAME");
  ok("the build writes a CNAME file", fs.existsSync(cnamePath));
  if (fs.existsSync(cnamePath)){
    const cname = fs.readFileSync(cnamePath, "utf8").trim();
    ok("CNAME holds exactly one bare hostname",
       /^[a-z0-9.-]+\.[a-z]{2,}$/.test(cname) && !cname.includes("/"), cname);
    const declared = fs.readFileSync(path.join(__dirname, "..", "scripts", "locations.py"), "utf8")
      .match(/^DOMAIN = "([^"]+)"/m);
    ok("CNAME matches the domain declared in locations.py",
       declared && declared[1] === cname, `${cname} vs ${declared && declared[1]}`);
  }
}
ok("exactly one site is primary", ALL.filter(s => s.primary).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
