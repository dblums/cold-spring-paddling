#!/usr/bin/env python3
"""Render every launch site from src/template.html.

    python3 scripts/build.py                # all sites
    python3 scripts/build.py beacon         # just one

Each site produces two files, both fully self-contained - no external requests
for anything the page needs to render, so it works with no signal once loaded:

  index.html     the site. This is what gets deployed.
  artifact.html  the same page without the <html>/<head>/<body> wrapper,
                 which is the shape Claude Artifacts expects.

Every launch is a flat file at the root named for its town and state -
cold-spring-new-york.html - so each page can compete for its own searches and
the slugs stay unique once the registry crosses a state line. The root itself
is an index of the launches. Adding a stretch of river means adding a JSON file
to locations/ and running the fetch script - nothing here changes.

Artifacts are written to artifacts/, which is kept out of the deployed site.
"""

import base64
import json
import os
import re
import sys

import locations as L

TEMPLATE = os.path.join(L.ROOT, "src", "template.html")
# A canoe emoji drawn into an SVG, so the favicon needs no separate file either.
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'"
           "%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%9B%B6%3C/text%3E%3C/svg%3E")


def strip_features(html, features):
    """Remove <!--@if name--> and /*@if name*/ blocks the site does not have."""
    for style in (r"<!--@if (\w+)-->(.*?)<!--@endif-->\n?", r"/\*@if (\w+)\*/(.*?)/\*@endif\*/\n?"):
        def keep(m):
            return m.group(2) if m.group(1) in features else ""
        html = re.sub(style, keep, html, flags=re.S)
    return html


def hero(site):
    """The artifact build inlines the photo because Claude Artifacts cannot fetch
    anything; the deployed page links to it instead. Inlining a 250 KB JPEG costs
    the whole page - the parser has to read past it before anything below can
    render - and buys nothing, since a decorative photo is the one thing the page
    can happily do without."""
    if not site.get("banner"):
        return {"HERO_CLASS": " hero-plain", "BANNER_IMG": ""}
    path = os.path.join(L.ROOT, "src", "banners", site["banner"])
    uri = "data:image/jpeg;base64," + base64.b64encode(open(path, "rb").read()).decode()
    alt = site.get("bannerAlt") or (site["name"] + " on the Hudson River")
    return {"HERO_CLASS": "",
            "BANNER_IMG": f'    <img src="{uri}" alt="{alt}" width="1600" height="1201" fetchpriority="high">\n'}


def locnav(site, sites):
    others = [s for s in sites if s["slug"] != site["slug"]]
    links = [f'<a href="{L.href(s)}">{s["name"]}</a>' for s in others]
    # the launches page carries the whole-river framing, so every page links it
    links.append('<a href="launches.html">All launches</a>')
    label = "Other launches" if others else "More"
    return (f'  <nav class="locnav"><span class="label">{label}</span> '
            + " ".join(links) + "</nav>\n")


def render(site, sites):
    html = strip_features(open(TEMPLATE).read(), set(site.get("features", [])))
    data = open(os.path.join(L.ROOT, "data", site["slug"] + ".json")).read().strip()
    cur, tide = site["current"], site["tide"]

    site_js = json.dumps({
        "slug": site["slug"], "name": site["name"],
        "lat": site["lat"], "lon": site["lon"], "riverMile": site["riverMile"],
        "nwsGrid": site["nws"]["grid"],
        "tideShiftMin": tide["shiftMin"], "curShiftMin": cur["shiftMin"],
        "floodToward": cur["floodToward"], "ebbToward": cur["ebbToward"],
    }, separators=(",", ":"))

    marsh_note = (" The &plusmn;2h trestle and mud rules are local rules of thumb &mdash; look at the"
                  " clearance yourself before you commit, and remember the tide inside the marsh lags"
                  " the river.") if "marsh" in site.get("features", []) else ""

    fields = {
        "PREDICTIONS": data, "SITE_JSON": site_js,
        "TITLE": site["title"], "NAME": site["name"],
        "TIDE_LABEL": tide["label"], "CURRENT_LABEL": cur["label"],
        "COORD_LABEL": f'computed for {site["lat"]:.2f}°N {abs(site["lon"]):.2f}°W',
        "UPRIVER": cur["upriverTo"], "DOWNRIVER": cur["downriverTo"],
        "CURRENT_NOTE": cur["note"], "TIDE_NOTE": tide["note"], "MARSH_NOTE": marsh_note,
        "TIDE_CARD_NOTE": tide["cardNote"],
        "NWS_LABEL": "NWS " + site["nws"]["grid"].split("/")[0],
        "CURRENT_LINK": cur["link"],
        "NWS_LINK": f'https://forecast.weather.gov/MapClick.php?lat={site["lat"]}&amp;lon={site["lon"]}',
        "LOCNAV": locnav(site, sites),
        **hero(site),
    }
    for token, value in fields.items():
        html = html.replace("{{" + token + "}}", str(value))

    left = re.findall(r"\{\{(\w+)\}\}", html)
    if left:
        raise SystemExit(f"{site['slug']}: unfilled placeholders {sorted(set(left))}")

    art = os.path.join(L.ROOT, "artifacts")
    os.makedirs(art, exist_ok=True)
    with open(os.path.join(art, site["slug"] + ".html"), "w") as f:
        f.write(html)

    # the deployed page links the photo rather than carrying it. Every page is a
    # flat file at the root now, so the photos cannot all be called banner.jpg.
    banner = L.banner_file(site)
    if site.get("banner"):
        src = os.path.join(L.ROOT, "src", "banners", site["banner"])
        with open(os.path.join(L.ROOT, banner), "wb") as f:
            f.write(open(src, "rb").read())
        html = re.sub(r'src="data:image/jpeg;base64,[A-Za-z0-9+/=]+"',
                      f'src="{banner}"', html, count=1)

    split = html.index('<div class="wrap">')
    head, body = html[:split].rstrip(), html[split:].rstrip()
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://api.weather.gov" crossorigin>
<link rel="preconnect" href="https://api.tidesandcurrents.noaa.gov" crossorigin>
<meta name="description" content="Hudson River tides, current and paddling conditions for {site['name']}, {site['state']}.">
<link rel="canonical" href="{L.page_url(site)}">
<meta name="theme-color" content="#eaeeee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1518" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="{site['name']} Tides">
<link rel="icon" href="{FAVICON}">
{head}
<style>
html{{-webkit-text-size-adjust:100%}}
img{{max-width:100%}}
[hidden]{{display:none!important}}
</style>
</head>
<body>
{body}
</body>
</html>
"""
    dest = os.path.join(L.ROOT, L.page_file(site))
    with open(dest, "w") as f:
        f.write(page)
    kb = os.path.getsize(dest) // 1024
    print(f"  {site['name']:14} -> {'/' + L.page_file(site):30} {kb} KB"
          + ("" if "marsh" in site.get("features", []) else "   (no marsh card)"))

    # Someone typing the bare domain wants conditions, not a directory, so the
    # primary launch answers there too. Both copies carry the same canonical
    # tag, so the duplicate is declared rather than left for Google to guess at.
    # A byte copy rather than a redirect: no blank flash, no second round trip,
    # and the build makes drift impossible.
    if site.get("primary"):
        with open(os.path.join(L.ROOT, "index.html"), "w") as f:
            f.write(page)
        print(f"  {'':14} -> {'/ (same page)':30} canonical {L.page_file(site)}")


def theme_css(template):
    """The colour variables, lifted from the page template so the index shares
    them rather than keeping a second copy that drifts."""
    start = template.index(":root{")
    end = template.index("*{box-sizing:border-box}")
    return template[start:end].rstrip()


def write_launches(sites):
    """The list of launches, with the static prose about what the site is.

    The bare domain goes straight to the primary launch, because someone typing
    hudsonconditions.com wants to know what the river is doing, not to pick from
    a menu of two. This page is where the whole-river framing lives instead, and
    every launch links to it."""
    template = open(TEMPLATE).read()
    cards = "\n".join(f'''      <li class="launch">
        <a href="{L.href(s)}">
          <h2>{s["name"]}<span>{s["state"]}</span></h2>
          <p>{s["blurb"]}</p>
        </a>
      </li>''' for s in sites)
    names = ", ".join(s["name"] for s in sites)
    page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Hudson River Paddling Conditions</title>
<meta name="description" content="Tide, current, wind and water temperature for paddlers on the tidal Hudson. Launch-by-launch conditions for {names}.">
<link rel="canonical" href="{L.SITE_URL}/launches.html">
<meta name="theme-color" content="#eaeeee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1518" media="(prefers-color-scheme: dark)">
<link rel="icon" href="{FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap">
<style>
{theme_css(template)}
*{{box-sizing:border-box}}
html{{-webkit-text-size-adjust:100%}}
body{{margin:0; background:var(--ground); color:var(--ink);
  font-family:"Barlow","Helvetica Neue",Helvetica,Arial,sans-serif; font-size:16px; line-height:1.55}}
.wrap{{max-width:720px; margin:0 auto; padding:56px 16px 64px}}
h1{{font-family:"Barlow Semi Condensed",sans-serif; font-weight:700; font-size:40px;
  line-height:1.1; margin:0 0 10px; letter-spacing:-.01em}}
.lede{{font-size:18px; color:var(--ink-2); margin:0 0 36px; max-width:54ch}}
ul.launches{{list-style:none; margin:0 0 40px; padding:0; display:grid; gap:14px}}
.launch a{{display:block; padding:20px 22px; background:var(--surface); border:1px solid var(--line);
  border-radius:12px; text-decoration:none; color:inherit; box-shadow:var(--shadow);
  transition:border-color .15s, transform .15s}}
.launch a:hover{{border-color:var(--river); transform:translateY(-1px)}}
.launch h2{{font-family:"Barlow Semi Condensed",sans-serif; font-size:25px; font-weight:600;
  margin:0 0 6px; display:flex; align-items:baseline; gap:10px}}
.launch h2 span{{font-family:"Barlow",sans-serif; font-size:13px; font-weight:500;
  text-transform:uppercase; letter-spacing:.08em; color:var(--muted)}}
.launch p{{margin:0; color:var(--ink-2); font-size:15px}}
.about h3{{font-family:"Barlow Semi Condensed",sans-serif; font-size:20px; margin:0 0 8px}}
.about p{{margin:0 0 14px; color:var(--ink-2); font-size:15.5px}}
footer{{margin-top:40px; padding-top:20px; border-top:1px solid var(--line);
  font-size:13.5px; color:var(--muted)}}
footer a{{color:var(--muted)}}
@media (max-width:520px){{ .wrap{{padding:36px 16px 48px}} h1{{font-size:32px}} }}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Hudson River Paddling Conditions</h1>
    <p class="lede">What the river is doing right now, and what it will be doing when you
      want to go. Tide, current, wind, water temperature and daylight for one launch at a
      time &mdash; written for paddlers rather than for mariners.</p>

    <ul class="launches">
{cards}
    </ul>

    <section class="about">
      <h3>What this is</h3>
      <p>The tidal Hudson runs 153 miles from the Battery to the federal dam at Troy, and
        for all of it the river goes both ways. The current can run well over a knot at
        Cold Spring, which is faster than a lot of people paddle, so whether you go north
        or south first is usually the difference between a pleasant afternoon and a long
        one.</p>
      <p>Tide and current predictions are astronomical, so they are computed years ahead
        and built into each page &mdash; they work with no signal once the page has loaded.
        Weather, alerts and water temperature come live from the National Weather Service
        and NOAA when there is a connection, and the page still works when there is not.</p>
      <h3>Picking a time</h3>
      <p>Every page takes a date and time, so you can look at Saturday afternoon before you
        commit to it. Tide and current for a future date are as good as they are for right
        now. Weather is a forecast, and the pages say so.</p>
    </section>

    <footer>
      Predictions and forecasts, not observations. Conditions on the water can differ from
      anything shown here, and your decisions are your own.
      Tide and current predictions from <a href="https://tidesandcurrents.noaa.gov/">NOAA CO-OPS</a>;
      weather from the <a href="https://www.weather.gov/">National Weather Service</a>.
    </footer>
  </div>
</body>
</html>
'''
    with open(os.path.join(L.ROOT, "launches.html"), "w") as f:
        f.write(page)
    kb = len(page.encode()) // 1024
    print(f"  {'Launches':14} -> {'/launches.html':30} {kb} KB")


def write_cname():
    """GitHub Pages reads a file literally named CNAME at the root of what it
    publishes, and serves the site at that name. Nothing to do with the CNAME
    DNS record - same word, different job.

    It lives in a directory that is otherwise all build output, so the build
    owns it. Left to the web UI that first created it, it is the one file here
    that no code knows about, and the day it goes missing the site quietly
    stops answering at its own domain."""
    path = os.path.join(L.ROOT, "CNAME")
    with open(path, "w") as f:
        f.write(L.DOMAIN + "\n")
    print(f"  {'CNAME':14} -> {'/CNAME':28} {L.DOMAIN}")


def main():
    wanted = set(sys.argv[1:])
    sites = L.load()
    targets = [s for s in sites if not wanted or s["slug"] in wanted]
    if wanted and not targets:
        raise SystemExit(f"no launch site matches {', '.join(wanted)}")
    for site in targets:
        render(site, sites)
    if not wanted:
        write_launches(sites)
        write_cname()


if __name__ == "__main__":
    main()
