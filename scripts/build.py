#!/usr/bin/env python3
"""Render every launch site from src/template.html.

    python3 scripts/build.py                # all sites
    python3 scripts/build.py beacon         # just one

Each site produces two files, both fully self-contained - no external requests
for anything the page needs to render, so it works with no signal once loaded:

  index.html     the site. This is what gets deployed.
  artifact.html  the same page without the <html>/<head>/<body> wrapper,
                 which is the shape Claude Artifacts expects.

The root site writes to the repository root so its URL never changes; every
other site gets its own directory. Adding a stretch of river means adding a
JSON file to locations/ and running the fetch script - nothing here changes.
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
    if not others:
        return ""
    links = " ".join(f'<a href="{L.href(s, site)}">{s["name"]}</a>' for s in others)
    return f'  <nav class="locnav"><span class="label">Other launches</span> {links}</nav>\n'


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

    out = L.out_dir(site)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "artifact.html"), "w") as f:
        f.write(html)

    # the deployed page links the photo rather than carrying it
    if site.get("banner"):
        src = os.path.join(L.ROOT, "src", "banners", site["banner"])
        with open(os.path.join(out, "banner.jpg"), "wb") as f:
            f.write(open(src, "rb").read())
        html = re.sub(r'src="data:image/jpeg;base64,[A-Za-z0-9+/=]+"', 'src="banner.jpg"', html, count=1)

    split = html.index('<div class="wrap">')
    head, body = html[:split].rstrip(), html[split:].rstrip()
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://api.weather.gov" crossorigin>
<link rel="preconnect" href="https://api.tidesandcurrents.noaa.gov" crossorigin>
<meta name="description" content="Hudson River tides, current and paddling conditions for {site['name']}, NY.">
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
    with open(os.path.join(out, "index.html"), "w") as f:
        f.write(page)
    rel = os.path.relpath(out, L.ROOT)
    kb = os.path.getsize(os.path.join(out, "index.html")) // 1024
    print(f"  {site['name']:14} -> {(rel if rel != '.' else '') + '/index.html':28} {kb} KB"
          + ("" if "marsh" in site.get("features", []) else "   (no marsh card)"))


def main():
    wanted = set(sys.argv[1:])
    sites = L.load()
    targets = [s for s in sites if not wanted or s["slug"] in wanted]
    if wanted and not targets:
        raise SystemExit(f"no launch site matches {', '.join(wanted)}")
    for site in targets:
        render(site, sites)


if __name__ == "__main__":
    main()
