/* Pure-logic tests. No network. Run: node tests/offline.js */
const {load, sites, pageFor, pageSlug} = require("./harness.js");
// the prediction window rolls forward, so the tests ask about now, not about 2028
const THIS_YEAR = new Date().getUTCFullYear();
const SITE_URL = "https://" + /^DOMAIN = "([^"]+)"/m.exec(require("fs")
  .readFileSync(require("path").join(__dirname, "..", "scripts", "locations.py"), "utf8"))[1];
const fs = require("fs");
const ALL = sites();
const ALL_WATER = ["The Battery", "Turkey Point", "Coxsackie", "Albany"];
const ALL_WATER_MILES = [0, 100, 126];
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
  /* The window rolls, so these cannot name a year. This is the alarm: if the
     monthly refresh ever stops, the horizon shrinks and this fails long before
     the site runs out of data - which is the whole point, since a static page
     has nothing to notice it for itself. */
  const YEAR = 365.25 * 24 * 3600e3;
  ok("data covers the current year", T.RANGE[0] <= Date.UTC(THIS_YEAR, 0, 2),
     fmt(T.RANGE[0]));
  ok("at least two years of data remain", T.RANGE[1] - Date.now() >= 2 * YEAR,
     `${((T.RANGE[1] - Date.now()) / YEAR).toFixed(2)} years, to ${fmt(T.RANGE[1])}`);
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
  const CW = T.COLD_WATER_F;
  ok("warm air over warm-enough water: no warning", !u(75, CW));
  ok("high total over warm-enough water: no warning", !u(61, CW));
  ok("120 total: warns",      u(70,50));
  ok("water 45 despite 125 total: warns", u(80,45));
  ok("air 45 despite 125 total: warns",   u(45,80));
  // the floor: warm air must never mask cold water, whatever the sum says
  ok("just under the floor warns even at a high total", u(71, CW - 1));
  ok("52F water warns at 124 total",       u(72,52));   // the May trap
  ok("the floor is exclusive, not inclusive", !u(75, CW) && u(75, CW - 1));
  /* The floor sits two degrees above the usual 60F line for cold-water shock,
     because no launch has a sensor in its own water and every reading comes
     from miles away. The margin lives here rather than in the displayed
     number. */
  ok("the cold-water floor carries a margin over 60F", CW >= 62 && CW <= 64, `${CW}`);
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
  /* A leading article is the launch's name too: "Near the Upper West Side"
     reads properly where "Near Upper West Side" does not. Strip it before
     comparing, so the check below still catches a page wearing the wrong
     name - no launch is called "the" plus another launch's name. */
  const named = t =>
    ((/Near ([^,]+),/.exec(t || "") || [])[1] || "").replace(/^the /, "");
  eq(`${site.name}: headline names this launch`, named(heading), site.name);
  eq(`${site.name}: title names this launch`, named(title), site.name);
  for (const other of ALL) if (other.slug !== site.slug){
    ok(`${site.name}: headline does not say ${other.name}`, named(heading) !== other.name, heading);
    ok(`${site.name}: title does not say ${other.name}`, named(title) !== other.name);
  }
  /* What Google quotes. Searching "hudson river paddling conditions" returned
     the Beacon page described as "It is dark out. A white light is required
     after dark" - the live hero, three days stale, because it was the only
     prose on the page. The time-specific blocks are now excluded from snippets
     and the launch has a standing description instead. */
  for (const id of ['id="brief"', 'id="stamp"', 'id="wxCard"'])
    ok(`${site.name}: ${id} is excluded from search snippets`,
       new RegExp(id.replace(/"/g, '"') + '[^>]*data-nosnippet').test(html), id);

  {
    const d = (/<meta name="description" content="([^"]*)"/.exec(html) || [])[1] || "";
    ok(`${site.name}: the description names this launch`, d.includes(site.name), d);
    /* A search result has to answer "what will this page tell me", not explain
       where the launch is - the reader has usually already picked the place. */
    for (const word of ["Tide", "current", "wind", "weather", "what they mean"])
      ok(`${site.name}: the description says it covers ${word}`, d.includes(word), d);
    // people search for the boat, not the activity
    for (const craft of ["kayak", "canoe", "paddleboard"])
      ok(`${site.name}: the description reaches people searching ${craft}`,
         d.toLowerCase().includes(craft), d);
    ok(`${site.name}: the description uses the two-letter state`,
       / N[YJ],/.test(d), d);
    ok(`${site.name}: the description is never cut mid-word`, !d.endsWith("\u2026"), d);
    // Google truncates past about 160, and a cut mid-word looks broken
    ok(`${site.name}: the description fits what Google shows`, d.length <= 160,
       `${d.length} chars`);
    ok(`${site.name}: the description is not time-specific`,
       !/\b(right now|today|this afternoon|\d{1,2}:\d{2})\b/i.test(d), d);
  }

  /* A link to this site travels by somebody pasting it into a group thread, and
     without these it arrives as a grey box. The image is the one photo there
     is, borrowed by every page that has none of its own. */
  for (const [what, tag] of [
      ["type", 'property="og:type" content="website"'],
      ["title", `property="og:title" content="${site.title}"`],
      ["url", `property="og:url" content="${SITE_URL}/${pageSlug(site)}.html"`],
      ["image", 'property="og:image" content="https://'],
      ["image alt", 'property="og:image:alt"'],
      ["twitter card", 'name="twitter:card" content="summary_large_image"']])
    ok(`${site.name}: share card has its ${what}`, html.includes(tag), tag.slice(0, 60));
  ok(`${site.name}: the share image is an absolute url`,
     /property="og:image" content="https:\/\/[^"]+\.jpg"/.test(html));

  /* Thirty-nine pages that differ by a town name look like one page duplicated
     unless something says otherwise. The coordinates are what says otherwise. */
  {
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    ok(`${site.name}: carries structured data`, !!m);
    if (m){
      let d = null;
      try { d = JSON.parse(m[1].replace(/<\\\//g, "</")); } catch (e) {}
      ok(`${site.name}: its structured data is valid JSON`, !!d, m[1].slice(0, 80));
      if (d){
        eq(`${site.name}: structured data names this launch`,
           d.about && d.about.name, `${site.name}, ${site.state}`);
        eq(`${site.name}: structured data carries this launch's latitude`,
           d.about.geo.latitude, site.lat);
        eq(`${site.name}: structured data carries this launch's longitude`,
           d.about.geo.longitude, site.lon);
        eq(`${site.name}: structured data points at this page`,
           d.url, `${SITE_URL}/${pageSlug(site)}.html`);
        ok(`${site.name}: structured data says the site is free`,
           d.isAccessibleForFree === true);
      }
      /* "</" inside a script element ends it, however it is escaped as JSON -
         so the one place a stray one could appear is checked directly. */
      ok(`${site.name}: structured data cannot close its own script tag`,
         !/<\/(?!script>)/.test(m[1]) && !m[1].includes("</script"), "raw </ found");
    }
  }

  /* The page states how far its predictions reach, in two places, and both used
     to be a date somebody typed. The window rolls now, so a hand-written date
     would start lying the first month it moved. */
  {
    // the span itself contains &nbsp; so a bare semicolon is the wrong anchor
    const through = /good through (.+?); values between/.exec(html);
    ok(`${site.name}: the page says how far its predictions reach`, !!through);
    if (through){
      const last = S.TIDE[S.TIDE.length - 1].t;
      const said = through[1].replace(/&nbsp;/g, " ").trim();
      const want = new Intl.DateTimeFormat("en-US",
        {day: "numeric", month: "short", year: "numeric", timeZone: "America/New_York"})
        .format(last).replace(",", "");
      // same day, whichever way the formatter orders it
      const parts = want.split(" ");
      ok(`${site.name}: the stated end matches the data`,
         parts.every(x => said.includes(x)), `page says "${said}", data ends ${want}`);
    }
    ok(`${site.name}: the out-of-range notice reads its span off the data`,
       !/from 1 Jan \d{4} through 31 Dec \d{4}/.test(html)
         && html.includes("fmtDay.format(RANGE[0])"), "hardcoded span found");
  }

  /* The footer names the launch inside a sentence, where a few places need an
     article. It is read off the title so the two cannot drift apart. */
  const phrase = (/grid covering ([^.]+)\./.exec(html) || [])[1] || "";
  ok(`${site.name}: the footer names this launch`, phrase.endsWith(site.name), phrase);
  ok(`${site.name}: the footer's name matches the title's`,
     phrase === named(title) || phrase === "the " + named(title), `${phrase} vs ${title}`);

  ok(`${site.name}: site config matches locations/`,
     S.SITE.slug === site.slug && S.SITE.lat === site.lat && S.SITE.riverMile === site.riverMile);
  eq(`${site.name}: tide shift`, S.TIDE_SHIFT_MIN, site.tide.shiftMin);
  eq(`${site.name}: NWS grid`, S.SITE.nwsGrid, site.nws.grid);
  ok(`${site.name}: page names its own NWS office`,
     html.includes("NWS " + site.nws.grid.split("/")[0]));
  ok(`${site.name}: shows its own station labels`,
     html.includes(site.tide.label) && html.includes(site.current.label));
  eq(`${site.name}: current shift`, S.CUR_SHIFT_MIN, site.current.shiftMin);
  /* Counting points instead of spans was calibrated on the Highlands and failed
     upriver, where NOAA publishes more current events per day - a fact about
     the river, not a fault in the data. Compare instants rather than year
     labels: the last event of a year in New York falls on 1 January in UTC,
     which is correct and not worth arguing with. */
  const START = Date.UTC(THIS_YEAR, 0, 2);
  const TWO_YEARS = Date.now() + 2 * 365.25 * 24 * 3600e3;
  for (const [what, arr] of [["tide", S.TIDE], ["current", S.CUR]]){
    ok(`${site.name}: ${what} data covers the current year`, arr[0].t <= START,
       new Date(arr[0].t).toISOString().slice(0,10));
    ok(`${site.name}: ${what} data runs two years out`, arr[arr.length-1].t >= TWO_YEARS,
       new Date(arr[arr.length-1].t).toISOString().slice(0,10));
  }
  const YEARS_HELD = 3;   // the rolling window: this year plus two
  ok(`${site.name}: tide events are plausibly twice-daily`,
     S.TIDE.length > YEARS_HELD * 365 * 3 && S.TIDE.length < YEARS_HELD * 365 * 5, `${S.TIDE.length}`);
  ok(`${site.name}: current events are plausibly a few times daily`,
     S.CUR.length > YEARS_HELD * 365 * 5 && S.CUR.length < YEARS_HELD * 365 * 12, `${S.CUR.length}`);
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
  const tideLink = (/stationhome\.html\?id=([A-Za-z0-9]+)/.exec(html) || [])[1];
  const curLink = (/noaacurrents\/predictions\.html\?id=([A-Z0-9_]+)/.exec(html) || [])[1];
  eq(`${site.name}: tide link points at its own station`, tideLink, site.tide.station);
  eq(`${site.name}: current link points at its own station`, curLink,
     `${site.current.station}_${site.current.bin}`);
  /* Scoped to the card labels, not the whole page: a station id can appear for
     a different job. The Battery is Lower Manhattan's TIDE station and also the
     downriver WATER-TEMPERATURE sensor for the Highlands launches, which is
     correct in both places. */
  const stationLabels = [...html.matchAll(/<span class="station">([\s\S]*?)<\/span>/g)]
    .map(m => m[1]).join(" | ");
  ok(`${site.name}: the card labels name its own tide station`,
     stationLabels.includes(site.tide.station), stationLabels);
  ok(`${site.name}: the card labels name no other launch's tide station`,
     !ALL.some(o => o.tide.station !== site.tide.station
                    && stationLabels.includes(o.tide.station)), stationLabels);

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

  /* Water temperature: both bracketing stations are always carried, and
     WATER_NEAR says whether one is close enough to prefer. Preferring is not
     depending - when Turkey Point went dark for a day, the launches that had
     dropped their far station showed nothing at all. */
  const ws = /const WATER_S = ({[^}]*}|null)/.exec(html)[1];
  const wn = /const WATER_N = ({[^}]*}|null)/.exec(html)[1];
  const wnear = /const WATER_NEAR = ("[a-z]+"|null)/.exec(html)[1];
  const wSouth = ws === "null" ? null : JSON.parse(ws);
  const wNorth = wn === "null" ? null : JSON.parse(wn);
  const near = wnear === "null" ? null : JSON.parse(wnear);
  const note = (/Water temperature[^<]*/.exec(html) || [""])[0];
  const who = w => (w.source === "usgs" ? "USGS " : "NOAA ") + w.name;

  ok(`${site.name}: has at least one water station`, !!(wSouth || wNorth));
  if (wSouth) ok(`${site.name}: downriver station is downriver`, wSouth.mile <= site.riverMile);
  if (wNorth) ok(`${site.name}: upriver station is upriver`, wNorth.mile > site.riverMile);

  if (near){
    const one = near === "north" ? wNorth : wSouth;
    const other = near === "north" ? wSouth : wNorth;
    const away = Math.abs(one.mile - site.riverMile);
    ok(`${site.name}: the preferred station is the near one`,
       away <= 12 || !other, `${away} mi`);
    ok(`${site.name}: the note names the preferred station`, note.includes(who(one)), note.slice(0,140));
    ok(`${site.name}: the note gives the distance`,
       note.includes(`${away} ${away === 1 ? "mile" : "miles"}`), note.slice(0,140));
    ok(`${site.name}: the note gives the direction`,
       note.includes(near === "north" ? "upriver" : "downriver"), note.slice(0,140));
    // the fallback must be named, or it is a dependency pretending to be a preference
    if (other)
      ok(`${site.name}: the note names the fallback gauge`,
         note.includes(who(other)) && /when that gauge is out/.test(note), note.slice(0,140));
    ok(`${site.name}: a preferred station claims no interpolation`,
       !/estimated between/.test(note), note.slice(0,140));
  } else if (wSouth && wNorth){
    ok(`${site.name}: the launch sits between its two stations`,
       wSouth.mile <= site.riverMile && site.riverMile <= wNorth.mile);
    ok(`${site.name}: the note names its downriver station`,
       note.includes(who(wSouth) + ", downriver"), note.slice(0,140));
    ok(`${site.name}: the note names its upriver station`,
       note.includes(who(wNorth) + ", up"), note.slice(0,140));
  }
  /* The card header names the agency, and it was hardcoded to NOAA until
     Albany - a USGS gauge - became the only source at Troy. */
  const agency = (/&middot; ([A-Z/]+) water temp/.exec(html) || [,""])[1];
  const agencies = [...new Set([wSouth, wNorth].filter(Boolean)
                      .map(w => w.source === "usgs" ? "USGS" : "NOAA"))].sort();
  ok(`${site.name}: the header names every agency it can draw on`,
     agencies.every(a => agency.split("/").includes(a)), `${agency} vs ${agencies}`);
  ok(`${site.name}: the header claims no agency it does not use`,
     agency.split("/").every(a => agencies.includes(a)), `${agency} vs ${agencies}`);

  ok(`${site.name}: the note names no unrelated station`,
     !ALL_WATER.some(w => w !== (wSouth && wSouth.name) && w !== (wNorth && wNorth.name)
                          && note.includes(w)), note.slice(0,140));

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

  /* date=latest errors out unless a station reported in the last few minutes,
     which made a merely-late sensor look dead and dropped the page back to a
     station 54 river miles away. Ask for a day of hourly readings instead. */
  for (const site of ALL){
    const html = fs.readFileSync(pageFor(site), "utf8");
    // in a query string, not in the comment that explains why we stopped
    ok(`${site.name}: water temp is not fetched with date=latest`,
       !/[?&]date=latest/.test(html));
    ok(`${site.name}: water temp asks for a day of readings`,
       html.includes("range=24&interval=h"));
    ok(`${site.name}: water temp reads the newest row, not the first`,
       /for \(let i = rows\.length - 1; i >= 0; i--\)/.test(html));
  }

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
/* The kept water reading.

   Albany is the only water sensor above Coxsackie and it belongs to USGS,
   which rate-limits: three reloads in a minute was enough to get 503s back and
   leave Troy showing a dash. A reading is kept for a week so an outage
   degrades to an older number rather than to nothing, and the tile dates it. */
{
  const {T, store} = load(ALL.find(s => s.slug === "troy") || ALL[0]);
  const {readWater, cacheWater, cachedWater, ago, WATER_KEEP_MS} = T;
  const HOUR = 3600e3, DAY = 24 * HOUR;
  const st = {id: "TESTSTN", name: "Test"};
  const fresh = r => ({status: "fulfilled", value: r});

  ok("a reading is kept for a week", WATER_KEEP_MS === 7 * DAY, String(WATER_KEEP_MS));

  /* CO-OPS is asked for gmt precisely so this stamp can be parsed. Ask for
     lst_ldt again and every age silently shifts by the reader's offset from
     the station - five hours in London, a day's worth by Sydney. */
  const coops = readWater(fresh({data: [
    {t: "2026-09-30 16:30", v: "64.0"}, {t: "2026-09-30 17:30", v: "66.4"}]}));
  ok("CO-OPS: takes the newest row", coops && coops.f === 66.4, JSON.stringify(coops));
  ok("CO-OPS: reads the stamp as UTC",
     coops && coops.t === Date.parse("2026-09-30T17:30:00Z"),
     coops && new Date(coops.t).toISOString());
  const built = fs.readFileSync(pageFor(ALL[0]), "utf8");
  ok("the page asks CO-OPS for gmt, which is what makes that parse right",
     built.includes("time_zone=gmt") && !built.includes("time_zone=lst_ldt"));

  const usgs = readWater(fresh({value: {timeSeries: [{values: [{value: [
    {dateTime: "2026-09-30T12:30:00.000-05:00", value: "18.1"}]}]}]}}));
  ok("USGS: converts Celsius to Fahrenheit",
     usgs && Math.abs(usgs.f - 64.58) < 0.01, JSON.stringify(usgs));
  ok("USGS: reads the stamp with its offset",
     usgs && usgs.t === Date.parse("2026-09-30T12:30:00.000-05:00"));
  ok("USGS: -999999 is not a temperature",
     readWater(fresh({value: {timeSeries: [{values: [{value: [
       {dateTime: "2026-09-30T12:30:00.000-05:00", value: "-999999"}]}]}]}})) === null);
  ok("a failed fetch reads as no reading",
     readWater({status: "rejected", reason: new Error("503")}) === null);

  // round trip, and the edges of the week
  store.clear();
  const now = Date.parse("2026-09-30T18:00:00Z");
  cacheWater(st, {f: 61.2, t: now - 3 * HOUR});
  const got = cachedWater(st, now);
  ok("a kept reading comes back", got && got.f === 61.2, JSON.stringify(got));

  cacheWater(st, {f: 55, t: now - 6 * DAY});
  ok("six days old is still offered", cachedWater(st, now) !== null);
  cacheWater(st, {f: 55, t: now - 8 * DAY});
  ok("eight days old is dropped", cachedWater(st, now) === null);
  cacheWater(st, {f: 55, t: now - WATER_KEEP_MS - 1});
  ok("a week and a minute is dropped", cachedWater(st, now) === null);

  /* A stamp ahead of now means the two clocks disagree, not that the river
     reported early. Left alone it would read as fresh forever. */
  cacheWater(st, {f: 55, t: now + 2 * HOUR});
  ok("a reading stamped in the future is dropped", cachedWater(st, now) === null);

  store.clear();
  ok("an unseen gauge has nothing kept", cachedWater(st, now) === null);
  store.setItem("hc.water.TESTSTN", "{not json");
  ok("corrupt storage reads as nothing kept", cachedWater(st, now) === null);
  store.setItem("hc.water.TESTSTN", JSON.stringify({f: "warm", t: now}));
  ok("a non-numeric temperature is not offered", cachedWater(st, now) === null);

  /* Private windows and blocked site data throw on access. The tile losing a
     fallback is fine; the page dying before it renders the tide is not. */
  const boom = {getItem(){ throw new Error("denied"); },
                setItem(){ throw new Error("denied"); }};
  const real = store.getItem, realSet = store.setItem;
  store.getItem = boom.getItem; store.setItem = boom.setItem;
  let threw = false;
  try { cacheWater(st, {f: 60, t: now}); cachedWater(st, now); } catch (e) { threw = true; }
  ok("storage that refuses to answer does not break the page", !threw);
  store.getItem = real; store.setItem = realSet;

  ok("ago: minutes", ago(now - 20 * 60e3, now) === "20 minutes ago", ago(now - 20 * 60e3, now));
  ok("ago: an hour", ago(now - 62 * 60e3, now) === "an hour ago", ago(now - 62 * 60e3, now));
  ok("ago: the last minute before the hour", ago(now - 59 * 60e3, now) === "59 minutes ago",
     ago(now - 59 * 60e3, now));
  ok("ago: hours", ago(now - 3 * HOUR, now) === "3 hours ago", ago(now - 3 * HOUR, now));
  ok("ago: days", ago(now - 3 * DAY, now) === "3 days ago", ago(now - 3 * DAY, now));
  ok("ago: never says hours past a day and a half",
     !/hours/.test(ago(now - 2 * DAY, now)), ago(now - 2 * DAY, now));
}

/* Everything the page shows that it did not write itself comes from NOAA or the
   Weather Service, and it goes into innerHTML. Neither is the threat model; a
   compromised or simply confused upstream is, and the cost of not trusting them
   is one escape call. An alert's event text reaches the page in three places
   and I had escaped two of them - this is here so the third cannot come back. */
{
  const {T} = load(ALL[0]);
  const NOON = T.fromNY(2026, 6, 15, 12, 0);
  const PAYLOAD = '<img src=x onerror="alert(1)">Flood Warning';

  ok("esc() neutralises a tag", !/[<>]/.test(T.esc(PAYLOAD)), T.esc(PAYLOAD));
  ok("esc() neutralises a quote", !/"/.test(T.esc('a"b')), T.esc('a"b'));
  ok("safeHref refuses a javascript: url",
     T.safeHref("javascript:alert(1)", "https://alerts.weather.gov/")
       === "https://alerts.weather.gov/");
  ok("safeHref refuses a data: url",
     T.safeHref("data:text/html,<script>", "FALLBACK") === "FALLBACK");
  ok("safeHref keeps a real one",
     T.safeHref("https://api.weather.gov/x", "FALLBACK") === "https://api.weather.gov/x");

  // and the whole way through, for each severity, since they are different branches
  for (const severity of ["Severe", "Minor"]){
    T.WX.alerts = [{properties: {event: PAYLOAD, severity,
      uri: "javascript:alert(2)", ends: new Date(NOON + 6 * 3600e3).toISOString()}}];
    const w = {windMph: 6, windGustMph: 6, windFromDeg: 180, airF: 74, waterF: 70, stormPct: 0};
    w.wx = T.precipWord([{weather: "rain</script><script>alert(3)</script>", coverage: "likely"}]);
    const b = T.buildBrief(NOON, 0.3, w, T.skyFor(NOON), NOON + 864e5);
    ok(`a ${severity} alert's text cannot open a tag in the summary`,
       !/<[a-z/!]/i.test(b.body), b.body.slice(0, 120));
    ok(`a ${severity} alert's text cannot open a tag in the headline`,
       !/<[a-z/!]/i.test(b.head), b.head);
  }
  // an unrecognised weather word is passed through, so it is held to a shape
  const odd = T.precipWord([{weather: "rain</script><script>", coverage: "likely"}]);
  ok("an unknown weather word cannot close the script tag it sits in",
     !/[<>/]/.test(odd.text + odd.noun + odd.adj), JSON.stringify(odd.text));
  T.WX.alerts = [];
}

/* The menu's leading column is river miles, which a bare number does not say.
   The heading has to name the unit and the thing it is measured from, and it
   has to stay put while the list scrolls - otherwise it explains the column
   only until you look for Kingston. */
{
  const html = fs.readFileSync(pageFor(ALL[0]), "utf8");
  const menu = /<div class="menu">([\s\S]*?)<\/div>/.exec(html);
  ok("the menu exists", !!menu);
  const head = /<span class="label menuhead">([^<]*)<\/span>/.exec(menu ? menu[1] : "");
  ok("the menu heading says what the numbers are", !!head, (menu && menu[1] || "").slice(0, 90));
  if (head){
    ok("it names the unit", /\bmiles\b/i.test(head[1]), head[1]);
    ok("it names what they are measured from", /harbor|harbour|battery/i.test(head[1]), head[1]);
    /* "river mile" is only meaningful to someone who already knows the term,
       which is the reader this heading is not for. */
    ok("it does not lean on the jargon it is there to replace",
       !/river mile/i.test(head[1]), head[1]);
  }
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const rule = /\.alllocs \.menu \.menuhead\{([^}]*)\}/.exec(css);
  ok("the heading is styled", !!rule);
  ok("the heading stays put while the list scrolls",
     rule && /position:sticky/.test(rule[1]), rule && rule[1].slice(0, 90));
  ok("the heading is opaque, so the list does not show through it",
     rule && /background:/.test(rule[1]), rule && rule[1].slice(0, 90));

  // the numbers it labels are the river miles, in river order
  const miles = [...(menu ? menu[1].matchAll(/<i>(\d+)<\/i>/g) : [])].map(m => +m[1]);
  const want = ALL.map(s => s.riverMile).sort((a, b) => a - b);
  eq("the menu lists every launch", miles.length, ALL.length);
  ok("the menu runs downriver to up", miles.every((m, i) => !i || m >= miles[i-1]), miles.join(","));
  ok("the numbers are the launches' river miles",
     miles.join(",") === want.join(","), miles.join(","));
}

/* On a phone the locations menu is wider than the control that opens it, so
   anchoring it to that control put it off the left edge of the screen whenever
   the control had wrapped to the start of a line - which it does on any launch
   whose two neighbours are long names. Schodack Landing lost 79px of every
   name: you could read "ewood Cliffs" and "ings-on-Hudson". The menu belongs
   to the nav on narrow screens, not to the summary. */
{
  const css = fs.readFileSync(pageFor(ALL[0]), "utf8");
  const mq = /@media \(max-width:520px\)\{([\s\S]*?)\n\}/.exec(css);
  ok("there is a narrow-screen rule for the menu", !!mq);
  const body = mq ? mq[1] : "";
  ok("the nav is the thing the menu is positioned against",
     /\.locnav\{[^}]*position:relative/.test(body), body.slice(0, 160));
  ok("the control is taken out of the positioning chain",
     /\.alllocs\{[^}]*position:static/.test(body), body.slice(0, 160));
  ok("the menu spans the nav rather than hanging off the control",
     /\.alllocs \.menu\{[^}]*left:0[^}]*right:0/.test(body), body.slice(0, 200));
  /* 210px of min-width is what made it wider than the control in the first
     place; left and right alone would not shrink it. */
  ok("the menu's desktop minimum width is cleared",
     /\.alllocs \.menu\{[^}]*min-width:0/.test(body), body.slice(0, 200));
}

/* The nav separator lives inside the second link, so the link's underline
   painted through the pipe - a stray underscore floating in front of the next
   name. An atomic inline-level box is not underlined by its parent. */
{
  const css = fs.readFileSync(pageFor(ALL[0]), "utf8");
  const rule = /\.locnav > a \+ a::before[^}]*}/.exec(css);
  ok("the nav separator is its own box, so no underline paints through it",
     rule && /display:\s*inline-block/.test(rule[0]), rule && rule[0].slice(0, 120));
}

/* Choosing between gauges, and saying which one won.

   The page must never show a dash where a temperature belongs: the reader is
   deciding what to wear. So it widens to the rest of the river rather than
   give up, and states the provenance of whatever it lands on. */
{
  const {T, store} = load(ALL.find(s => s.slug === "troy") || ALL[0]);
  const {bestWater, waterSub, waterCost, WATER_ALL, AGE_MILES_PER_DAY, cacheWater} = T;
  const HOUR = 3600e3, DAY = 24 * HOUR, now = Date.parse("2026-09-30T18:00:00Z");
  const mile = T.SITE.riverMile;
  const stn = n => WATER_ALL.find(s => s.name === n);
  const albany = stn("Albany"), cox = stn("Coxsackie"), bat = stn("The Battery");

  ok("a day of age is priced in river miles", AGE_MILES_PER_DAY > 0 && AGE_MILES_PER_DAY < 60,
     String(AGE_MILES_PER_DAY));
  ok("a live gauge costs only its distance",
     Math.abs(waterCost(albany, now, now) - Math.abs(albany.mile - mile)) < 0.01);
  ok("age adds to the cost",
     waterCost(albany, now - DAY, now) > waterCost(albany, now, now));

  /* The case this exists for. Albany is 8 miles from Troy and is the
     only gauge above Coxsackie; when it is late, a three-hour-old reading from
     it still beats a live one 26 miles downriver. */
  store.clear();
  cacheWater(albany, {f: 61.4, t: now - 3 * HOUR});
  let best = bestWater([{st: cox, f: 66.0, t: now}], now);
  ok("a near stale gauge beats a far live one", best.from === "Albany", best.from);
  ok("and it is flagged as kept", best.kept === true);

  // but not indefinitely: five days out, the live one wins
  store.clear();
  cacheWater(albany, {f: 61.4, t: now - 5 * DAY});
  best = bestWater([{st: cox, f: 66.0, t: now}], now);
  ok("a far live gauge beats a badly stale near one", best.from === "Coxsackie", best.from);

  // a live near gauge always wins
  store.clear();
  best = bestWater([{st: albany, f: 64, t: now}, {st: cox, f: 66, t: now}], now);
  ok("the nearest live gauge wins", best.from === "Albany", best.from);
  ok("a live reading is not marked kept", best.kept === false);

  store.clear();
  ok("nothing live and nothing kept yields nothing", bestWater([], now) === null);

  /* Last resort. Every gauge quiet and the kept reading past its week is still
     better than a dash, as long as the tile says how old it is. */
  cacheWater(albany, {f: 58, t: now - 12 * DAY});
  ok("an expired reading is not offered normally", bestWater([], now) === null);
  const old = bestWater([], now, true);
  ok("an expired reading is offered as a last resort", old && old.from === "Albany");
  ok("and it is dated, not passed off as current",
     /\d+ days ago/.test(waterSub(old, now)), waterSub(old, now));

  // what the tile says
  store.clear();
  const near = bestWater([{st: albany, f: 64, t: now}], now);
  ok("a launch's own gauge needs no distance - the footer explains it",
     waterSub(near, now) === "from Albany", waterSub(near, now));
  const far = bestWater([{st: cox, f: 66, t: now}], now);
  ok("a gauge off the rest of the river gets its distance",
     waterSub(far, now) === "from Coxsackie, 27 miles downriver", waterSub(far, now));
  ok("a far gauge is not called one of this launch's own", far.bracket === false);
  ok("distance names the direction the gauge actually lies",
     waterSub(bestWater([{st: bat, f: 70, t: now}], now), now).includes("downriver"));
  ok("a recent live reading is not cluttered with its age",
     !/ago/.test(waterSub(near, now)), waterSub(near, now));
  ok("a reading hours old says so",
     /ago/.test(waterSub(bestWater([{st: albany, f: 64, t: now - 5 * HOUR}], now), now)));
  ok("interpolation is still called an estimate",
     waterSub({from: "both"}, now) === "estimated");
}

/* Comments are stripped from the shipped page. src/template.html stays
   heavily commented - that is where the reasoning lives - but it was 20 KB of
   every page, on 33 pages, downloaded by someone standing at a launch. The
   danger is a careless strip eating the // in an https:// URL, so check the
   URLs survived and that the source still has its comments. */
{
  const path = require("path");
  const page = fs.readFileSync(pageFor(ALL[0]), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];

  ok("the shipped script has no line-leading block comments",
     !/^[ \t]*\/\*/m.test(script),
     (/^[ \t]*\/\*.*/m.exec(script) || [""])[0].slice(0, 80));
  ok("the shipped script has no line-leading // comments",
     !/^[ \t]*\/\//m.test(script),
     (/^[ \t]*\/\/.*/m.exec(script) || [""])[0].slice(0, 80));

  // the thing a naive strip breaks
  for (const url of ["https://api.weather.gov", "https://api.tidesandcurrents.noaa.gov",
                     "https://waterservices.usgs.gov"])
    ok(`stripping left ${url} intact`, page.includes(url));

  const src = fs.readFileSync(path.join(__dirname, "..", "src", "template.html"), "utf8");
  ok("the source template keeps its comments", /^[ \t]*\/\*/m.test(src));
  /* Not page-vs-source - the page carries baked tide and current arrays the
     template does not. Measure what the strip removes from the script. */
  const srcScript = /<script>([\s\S]*?)<\/script>/.exec(src)[1];
  const removed = (srcScript.match(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n?/gm) || [])
    .concat(srcScript.match(/^[ \t]*\/\/[^\n]*\n/gm) || [])
    .reduce((n, c) => n + c.length, 0);
  ok("stripping removes a worthwhile amount", removed > 8000, `${removed} bytes per page`);
}

/* Nothing shipped may still contain a placeholder. The build fills launch
   pages by {{TOKEN}} and the thank-you page by __TOKEN__, and putting an
   f-string placeholder into the one built with .replace() printed a literal
   "{analytics()}" into the page. Every file the build writes, every shape. */
{
  const path = require("path");
  const built = ALL.map(s => pageSlug(s) + ".html")
    .concat(["index.html", "thanks.html", "robots.txt", "sitemap.xml"]);
  for (const f of built){
    const p = path.join(__dirname, "..", f);
    if (!fs.existsSync(p)){ ok(`${f} exists`, false); continue; }
    const txt = fs.readFileSync(p, "utf8");
    ok(`${f} has no unfilled {{token}}`, !/\{\{[A-Z_]+\}\}/.test(txt),
       (/\{\{[A-Z_]+\}\}/.exec(txt) || [""])[0]);
    ok(`${f} has no unfilled __TOKEN__`, !/__[A-Z][A-Z_]+__/.test(txt),
       (/__[A-Z][A-Z_]+__/.exec(txt) || [""])[0]);
    ok(`${f} has no leaked python expression`, !/\{[a-z_]+\(\)\}/.test(txt),
       (/\{[a-z_]+\(\)\}/.exec(txt) || [""])[0]);
  }
}

/* A sitemap and a robots.txt. Thirty-nine pages with one link between each and
   its two neighbours are a chain a crawler has to walk; a sitemap is the list.
   Both are build output, so both are checked against the registry rather than
   against a copy of it that someone remembered to update. */
{
  const path = require("path");
  const root = f => path.join(__dirname, "..", f);

  ok("the build writes a sitemap", fs.existsSync(root("sitemap.xml")));
  ok("the build writes a robots.txt", fs.existsSync(root("robots.txt")));

  if (fs.existsSync(root("sitemap.xml"))){
    const xml = fs.readFileSync(root("sitemap.xml"), "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    const want = ALL.map(s => `${SITE_URL}/${pageSlug(s)}.html`).sort();

    ok("the sitemap declares its namespace",
       xml.includes("http://www.sitemaps.org/schemas/sitemap/0.9"));
    eq("the sitemap lists every launch", locs.length, ALL.length);
    ok("the sitemap lists exactly the launches that exist",
       locs.slice().sort().join("\n") === want.join("\n"),
       locs.filter(u => !want.includes(u)).join(", ") || "ordering");
    ok("no launch is listed twice", new Set(locs).size === locs.length);
    /* The bare domain serves Cold Spring under a canonical pointing at its own
       page. Listing both would ask a crawler to choose between two addresses
       for one page, which the canonical has already answered. */
    ok("the sitemap does not also list the bare domain",
       !locs.includes(SITE_URL + "/") && !locs.includes(SITE_URL + "/index.html"));
    ok("every url is absolute and https", locs.every(u => u.startsWith("https://")));
    ok("the sitemap carries a lastmod", /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(xml));
  }

  if (fs.existsSync(root("robots.txt"))){
    const txt = fs.readFileSync(root("robots.txt"), "utf8");
    ok("robots.txt points at the sitemap",
       txt.includes(`Sitemap: ${SITE_URL}/sitemap.xml`), txt);
    ok("robots.txt lets the launches be crawled", /^Allow: \/$/m.test(txt), txt);
    // the thank-you page is already noindex; a crawler that ignores that still
    // has no reason to go there
    ok("robots.txt keeps crawlers off the thank-you page",
       /^Disallow: \/thanks\.html$/m.test(txt), txt);
    ok("robots.txt blocks nothing else",
       (txt.match(/^Disallow:/gm) || []).length === 1, txt);
  }
}

ok("exactly one site is primary", ALL.filter(s => s.primary).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
