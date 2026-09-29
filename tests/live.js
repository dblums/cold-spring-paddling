/* Checks the baked-in predictions and the computed astronomy against the
   authorities they claim to come from. Needs network. Run: node tests/live.js */
const {load, sites, pageFor} = require("./harness.js");
const {T} = load();
const MIN = 60000;

let pass = 0, fail = 0;
function ok(name, cond, detail){
  if (cond) pass++; else { fail++; console.log("  FAIL  " + name + (detail ? "\n        " + detail : "")); }
}
const hm = ms => ms == null ? "--:--" : new Intl.DateTimeFormat("en-GB",
  {hour:"2-digit", minute:"2-digit", hour12:false, timeZone:"America/New_York"}).format(ms);
const toMin = s => s ? (+s.slice(0,2))*60 + (+s.slice(3,5)) : null;
const gap = (a,b) => { let d = toMin(a) - toMin(b); if (d > 720) d -= 1440; if (d < -720) d += 1440; return Math.abs(d); };
const get = async u => (await fetch(u, {headers:{"User-Agent":"cold-spring-paddling tests"}})).json();

(async () => {
  /* ---- tide extremes vs NOAA, including the 30-minute Cold Spring shift ---- */
  console.log("\nTide extremes vs NOAA station 8518934 (Beacon), shifted -30 min");
  {
    const j = await get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions"
      + "&application=tests&begin_date=20261001&end_date=20261007&datum=MLLW&station=8518934"
      + "&time_zone=lst_ldt&units=english&interval=hilo&format=json");
    let worstT = 0, worstV = 0;
    for (const p of j.predictions){
      const [d, t] = p.t.split(" ");
      const [Y,M,D] = d.split("-").map(Number), [h,mi] = t.split(":").map(Number);
      const want = T.fromNY(Y,M,D,h,mi) - 30*MIN;                 // page should be 30 min earlier
      const mine = T.TIDE.reduce((a,b) => Math.abs(b.t-want) < Math.abs(a.t-want) ? b : a);
      worstT = Math.max(worstT, Math.abs(mine.t - want) / MIN);
      worstV = Math.max(worstV, Math.abs(mine.v - parseFloat(p.v)));
      ok(`type matches at ${p.t}`, mine.type === p.type, `${mine.type} vs ${p.type}`);
    }
    ok("every tide time is exactly 30 min before Beacon", worstT === 0, `worst ${worstT} min`);
    ok("tide heights match to 0.01 ft", worstV <= 0.011, `worst ${worstV.toFixed(3)} ft`);
  }

  /* ---- current extremes vs NOAA, unshifted ---- */
  console.log("\nCurrent extremes vs NOAA ACT3726 bin 1 (West Point), unshifted");
  {
    const j = await get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=currents_predictions"
      + "&application=tests&begin_date=20261001&end_date=20261007&station=ACT3726&bin=1"
      + "&time_zone=lst_ldt&units=english&interval=MAX_SLACK&format=json");
    let worstT = 0, worstV = 0;
    for (const p of j.current_predictions.cp){
      const [d, t] = p.Time.split(" ");
      const [Y,M,D] = d.split("-").map(Number), [h,mi] = t.split(":").map(Number);
      const want = T.fromNY(Y,M,D,h,mi);
      const mine = T.CUR.reduce((a,b) => Math.abs(b.t-want) < Math.abs(a.t-want) ? b : a);
      worstT = Math.max(worstT, Math.abs(mine.t - want) / MIN);
      worstV = Math.max(worstV, Math.abs(mine.v - parseFloat(p.Velocity_Major)));
    }
    ok("every current time matches the station exactly", worstT === 0, `worst ${worstT} min`);
    ok("current speeds match to 0.01 kt", worstV <= 0.011, `worst ${worstV.toFixed(3)} kt`);
  }

  /* ---- interpolation between the published points ---- */
  console.log("\nInterpolation vs NOAA 6-minute series");
  {
    const t = await get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions"
      + "&application=tests&begin_date=20261005&end_date=20261008&datum=MLLW&station=8518934"
      + "&time_zone=lst_ldt&units=english&format=json");
    let sum = 0, worst = 0, n = 0;
    for (const p of t.predictions){
      const [d, tm] = p.t.split(" ");
      const [Y,M,D] = d.split("-").map(Number), [h,mi] = tm.split(":").map(Number);
      const mine = T.tideAt(T.fromNY(Y,M,D,h,mi) - 30*MIN);
      if (mine == null) continue;
      const e = Math.abs(mine - parseFloat(p.v)); sum += e; worst = Math.max(worst, e); n++;
    }
    ok("tide interpolation mean error under 0.12 ft", sum/n < 0.12, `mean ${(sum/n).toFixed(3)}, worst ${worst.toFixed(3)}, n=${n}`);

    const c = await get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=currents_predictions"
      + "&application=tests&begin_date=20261005&end_date=20261008&station=HUR0611&bin=16"
      + "&time_zone=lst_ldt&units=english&format=json");
    // ACT3726 is a subordinate station with no 6-minute series, so the quarter-sine
    // shape is checked against the reference station it is derived from
    const ext = await get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=currents_predictions"
      + "&application=tests&begin_date=20261004&end_date=20261009&station=HUR0611&bin=16"
      + "&time_zone=lst_ldt&units=english&interval=MAX_SLACK&format=json");
    const pts = ext.current_predictions.cp.map(p => {
      const [d,tm]=p.Time.split(" "); const [Y,M,D]=d.split("-").map(Number), [h,mi]=tm.split(":").map(Number);
      return {t:T.fromNY(Y,M,D,h,mi), v:parseFloat(p.Velocity_Major)};
    });
    const quarterSine = t0 => {
      for (let i=0;i<pts.length-1;i++){
        const a=pts[i], b=pts[i+1];
        if (t0>=a.t && t0<=b.t){
          const f=(t0-a.t)/(b.t-a.t);
          return Math.abs(a.v)<0.05 ? b.v*Math.sin(Math.PI/2*f) : a.v*Math.cos(Math.PI/2*f);
        }
      }
      return null;
    };
    let s2=0, w2=0, n2=0;
    for (const p of c.current_predictions.cp){
      const [d,tm]=p.Time.split(" "); const [Y,M,D]=d.split("-").map(Number), [h,mi]=tm.split(":").map(Number);
      const mine = quarterSine(T.fromNY(Y,M,D,h,mi));
      if (mine==null) continue;
      const e=Math.abs(mine-parseFloat(p.Velocity_Major)); s2+=e; w2=Math.max(w2,e); n2++;
    }
    ok("quarter-sine current shape mean error under 0.08 kt", s2/n2 < 0.08, `mean ${(s2/n2).toFixed(3)}, worst ${w2.toFixed(3)}, n=${n2}`);
  }

  /* ---- astronomy vs the US Naval Observatory ---- */
  console.log("\nSun and moon vs US Naval Observatory");
  {
    const days = ["2026-01-15","2026-03-20","2026-06-21","2026-09-24","2026-12-05","2027-07-04","2028-04-18","2028-11-20"];
    const worst = {sunrise:0, sunset:0, dawn:0, dusk:0, moonrise:0, moonset:0, illum:0};
    for (const day of days){
      const [Y,M,D] = day.split("-").map(Number);
      const noon = T.fromNY(Y,M,D,12,0);
      const off = Math.round((Date.UTC(Y,M-1,D,12,0) - noon) / 3600000);
      let u;
      try { u = (await get(`https://aa.usno.navy.mil/api/rstt/oneday?date=${day}&coords=41.4204,-73.9568&tz=${off}`)).properties.data; }
      catch(e){ console.log("  (USNO unavailable for " + day + ")"); continue; }
      const k = T.skyFor(noon);
      const sun = Object.fromEntries(u.sundata.map(x => [x.phen, x.time]));
      const moon = Object.fromEntries(u.moondata.map(x => [x.phen, x.time]));
      const pairs = {
        sunrise:[hm(k.sunrise), sun["Rise"]], sunset:[hm(k.sunset), sun["Set"]],
        dawn:[hm(k.dawn), sun["Begin Civil Twilight"]], dusk:[hm(k.dusk), sun["End Civil Twilight"]],
        moonrise:[hm(k.moonrise), moon["Rise"]], moonset:[hm(k.moonset), moon["Set"]]
      };
      for (const [key,[mine,theirs]] of Object.entries(pairs))
        if (theirs && mine !== "--:--") worst[key] = Math.max(worst[key], gap(mine, theirs));
      worst.illum = Math.max(worst.illum, Math.abs(k.lit - parseInt(u.fracillum)));
    }
    ok("sunrise within 2 min of USNO", worst.sunrise <= 2, `worst ${worst.sunrise} min`);
    ok("sunset within 3 min of USNO",  worst.sunset  <= 3, `worst ${worst.sunset} min`);
    ok("civil dawn within 3 min",      worst.dawn    <= 3, `worst ${worst.dawn} min`);
    ok("civil dusk within 3 min",      worst.dusk    <= 3, `worst ${worst.dusk} min`);
    ok("moonrise within 12 min",       worst.moonrise<= 12, `worst ${worst.moonrise} min`);
    ok("moonset within 12 min",        worst.moonset <= 12, `worst ${worst.moonset} min`);
    ok("illumination within 2 points", worst.illum   <= 2, `worst ${worst.illum} points`);
    console.log("   observed worst: " + JSON.stringify(worst));
  }

  /* ---- the live endpoints the page depends on ---- */
  console.log("\nLive endpoints still answering");
  {
    const grid = await get("https://api.weather.gov/gridpoints/OKX/30,74");
    const p = grid.properties;
    for (const k of ["temperature","windSpeed","windGust","windDirection","skyCover",
                     "probabilityOfPrecipitation","probabilityOfThunder","apparentTemperature"])
      ok(`NWS gridpoint has ${k}`, p[k] && p[k].values && p[k].values.length > 0);
    ok("wind direction is in degrees", p.windDirection.uom.includes("degree"), p.windDirection.uom);

    const al = await get("https://api.weather.gov/alerts/active?point=41.4204,-73.9568");
    ok("NWS alerts endpoint responds", Array.isArray(al.features), `${(al.features||[]).length} active`);

    /* Every water station any launch is configured to use, not a fixed pair.
       Coxsackie went unnoticed for a week because nothing here was reading the
       registry - the list was written when Cold Spring was the only launch. */
    const stations = new Map();
    for (const site of sites()){
      const html = require("fs").readFileSync(pageFor(site), "utf8");
      for (const m of html.matchAll(/const WATER_[SN] = ({[^}]*})/g)){
        const w = JSON.parse(m[1]);
        stations.set(w.id, (w.source === "usgs" ? "USGS " : "NOAA ") + w.name);
      }
    }
    ok("more than one bracketing pair is in use", stations.size >= 3,
       [...stations.values()].join(", "));
    /* A single station dropping out is normal operations - NOAA sensors go down
       for maintenance and the page already falls back to the other end of the
       bracket. What would actually break the feature is the endpoint changing
       shape, or every station being dark at once. So: report the outages, fail
       only if none of them answer. */
    const dark = [];
    for (const [id,name] of stations){
      // the same queries the page makes. Albany's gauge is USGS, in Celsius,
      // with -999999 for no reading; everything else is CO-OPS in Fahrenheit.
      let v = NaN;
      if (/^\d{8}$/.test(id)){
        const w = await get("https://waterservices.usgs.gov/nwis/iv/?format=json&sites="
          + id + "&parameterCd=00010&period=P1D");
        const ts = w.value && w.value.timeSeries && w.value.timeSeries[0];
        const vs = (ts && ts.values && ts.values[0] && ts.values[0].value) || [];
        const good = vs.filter(r => parseFloat(r.value) > -100);
        if (good.length) v = parseFloat(good[good.length - 1].value) * 9 / 5 + 32;
      } else {
        const w = await get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_temperature"
          + "&application=tests&range=24&interval=h&station=" + id + "&time_zone=lst_ldt&units=english&format=json");
        const rows = (w.data || []).filter(r => isFinite(parseFloat(r.v)));
        if (rows.length) v = parseFloat(rows[rows.length - 1].v);
      }
      if (isFinite(v) && v > 20 && v < 95) ok(`${name} water temp is reporting`, true);
      else { dark.push(name); console.log(`  note  ${name} is not reporting right now (${v}F)`); }
    }
    ok("at least one water station is reporting", dark.length < stations.size,
       `dark: ${dark.join(", ") || "none"}`);
    ok("no more than half the water stations are dark", dark.length * 2 <= stations.size,
       `${dark.length} of ${stations.size} dark: ${dark.join(", ")}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
