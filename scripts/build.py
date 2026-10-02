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
the slugs stay unique once the registry crosses a state line. The primary
launch is also written to index.html, so the bare domain serves conditions
rather than a menu. Adding a stretch of river means adding a JSON file to
locations/ and running the fetch script - nothing here changes.

Artifacts are written to artifacts/, which is kept out of the deployed site.
"""

import base64
import datetime
import json
import os
import re
import sys

from zoneinfo import ZoneInfo

import locations as L

# the predictions are stored as minutes since the epoch; reading them back as
# dates has to happen in the river's own timezone, not the builder's
NY = ZoneInfo("America/New_York")

TEMPLATE = os.path.join(L.ROOT, "src", "template.html")
# A canoe emoji drawn into an SVG, so the favicon needs no separate file either.
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'"
           "%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%9B%B6%3C/text%3E%3C/svg%3E")


def dir_word(deg):
    """North or south, always. Mirrors dirWord() in the template, because the
    column headings are static markup and the prose below them is not."""
    d = deg % 360
    return "north" if (d <= 90 or d >= 270) else "south"


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


def tip():
    """The nudge above Sun & Moon. No link configured, no module - better a
    missing ask than a button that goes nowhere.

    The photo is the argument: the person asking actually paddles here, in
    weather, with his kid. Cropped square and shrunk to 224px, so it costs
    20 KB and loads lazily well below the fold."""
    dest = os.path.join(L.ROOT, L.TIP_PHOTO) if L.TIP_PHOTO else None
    if not L.TIP_URL:
        # no module means no photo either; the build cleans up what it stopped
        # emitting rather than leaving a stray file served at the domain
        if dest and os.path.exists(dest):
            os.remove(dest)
        return ""
    photo = ""
    if L.TIP_PHOTO:
        src = os.path.join(L.ROOT, "src", "photos", L.TIP_PHOTO)
        with open(dest, "wb") as f:
            f.write(open(src, "rb").read())
        photo = (f'    <img src="{L.TIP_PHOTO}" alt="{L.TIP_PHOTO_ALT}"'
                 ' width="224" height="224" loading="lazy" decoding="async">\n')
    return ('  <section class="tip">\n'
            + photo
            + f'    <p>{L.TIP_LINE}</p>\n'
            f'    <a href="{L.TIP_URL}" target="_blank" rel="noopener">{L.TIP_CTA}</a>\n'
            '  </section>\n\n')


def water_fields(site):
    """The two water-temperature stations bracketing this launch, and a footer
    sentence that names them and says which way each one lies. The old copy was
    a single hardcoded sentence - "Turkey Point, upriver, and The Battery, down"
    - which was true only for the Highlands. At Hudson, Turkey Point is
    DOWNriver, so the page was telling readers the opposite of the fact."""
    south, north = L.water_pair(site)
    near = L.water_near(site)
    # the gauges are not all NOAA's - the one at Albany is USGS - so name the
    # agency per station rather than assuming
    who = lambda st: ("USGS " if st.get("source") == "usgs" else "NOAA ") + st["name"]
    if near:
        one = north if near == "north" else south
        other = south if near == "north" else north
        way = "upriver" if near == "north" else "downriver"
        miles = abs(one["mile"] - site["riverMile"])
        unit = "mile" if miles == 1 else "miles"
        tail = "." if miles <= L.NEAR_MILES else " \u2014 the nearest sensor on the river."
        note = f"Water temperature comes from {who(one)}, {miles} {unit} {way}{tail}"
        if other:
            note = note[:-1] + f", or {who(other)} when that gauge is out."
    elif south and north:
        note = ("Water temperature has no nearby sensor &mdash; it is estimated between "
                f"{who(south)}, downriver, and {who(north)}, up.")
    elif north or south:
        # nothing on one side: the launch is past the end of the sensors
        one = north or south
        way = "upriver" if north else "downriver"
        miles = abs(one["mile"] - site["riverMile"])
        unit = "mile" if miles == 1 else "miles"
        tail = "." if miles <= L.NEAR_MILES else " \u2014 the nearest sensor on the river."
        note = (f"Water temperature comes from {who(one)}, {miles} {unit} {way}{tail}")
    else:
        note = "Water temperature has no nearby sensor."
    # The card header used to say "NOAA water temp" on every page, which was
    # wrong at Troy the moment Albany - a USGS gauge - became its only
    # source. Name whichever agencies can actually supply this launch.
    agency = "/".join(sorted({"NOAA" if st.get("source") != "usgs" else "USGS"
                              for st in (south, north) if st}))
    return {
        "WATER_S_JSON": json.dumps(south, separators=(",", ":")) if south else "null",
        "WATER_N_JSON": json.dumps(north, separators=(",", ":")) if north else "null",
        "WATER_NEAR": json.dumps(near),
        "WATER_NOTE": note,
        "WATER_AGENCY": agency or "no",
        # Every gauge on the river, so a page with both its own out can reach
        # further rather than show a dash. Only fetched when it comes to that.
        "WATER_ALL_JSON": json.dumps(L.WATER_STATIONS, separators=(",", ":")),
    }


def locnav(site, sites):
    """The two launches either side of this one, then everything else behind a
    disclosure.

    Listing them all side by side worked at three and was a wall at thirty. The
    two a reader actually wants are the ones immediately up and down the river
    from where they are standing - the rest is a menu, not a nav."""
    ordered = sorted(sites, key=lambda s: s["riverMile"])
    if len(ordered) < 2:
        return ""
    i = next(n for n, s in enumerate(ordered) if s["slug"] == site["slug"])
    near = []
    if i > 0:
        d = ordered[i - 1]
        near.append(f'<a href="{L.href(d)}">{d["name"]}</a>')
    if i < len(ordered) - 1:
        u = ordered[i + 1]
        near.append(f'<a href="{L.href(u)}">{u["name"]}</a>')
    # the menu runs downriver to up, so it reads as a trip up the Hudson
    # the river mile leads, right-aligned, so the column reads as a trip upriver
    items = "".join(
        (f'      <span class="here"><i>{s["riverMile"]}</i>{s["name"]}</span>\n'
         if s["slug"] == site["slug"]
         else f'      <a href="{L.href(s)}"><i>{s["riverMile"]}</i>{s["name"]}</a>\n')
        for s in ordered)
    return ('  <nav class="locnav">\n'
            '    <span class="label">Nearby locations</span>\n'
            f'    {" ".join(near)}\n'
            '    <details class="alllocs" id="allLocs">\n'
            f'      <summary>All {len(ordered)} locations</summary>\n'
            '      <div class="menu">\n'
            '        <span class="label menuhead">Miles from New York Harbor</span>\n'
            f'{items}'
            '      </div>\n'
            '    </details>\n'
            '  </nav>\n')


# Only comments that begin a line. A string literal cannot span a line break in
# JavaScript, so a line whose first non-space characters are // or /* is a
# comment and nothing else - no risk of eating the // in an https:// URL, which
# a naive strip does. The one construct that could span lines is a template
# literal; assert there are none rather than trust it.
LEAD_BLOCK = re.compile(r"^[ \t]*/\*.*?\*/[ \t]*\n?", re.S | re.M)
LEAD_LINE = re.compile(r"^[ \t]*//[^\n]*\n", re.M)
BLANKS = re.compile(r"\n{3,}")


def strip_comments(html):
    """Drop the source comments from the shipped page.

    src/template.html is heavily commented on purpose - that is where the
    reasoning lives - but the reader on a phone at the launch does not need to
    download it. This is 20 KB of every page, on 33 pages."""
    def clean(m):
        body = m.group(2)
        if body.count("`") % 2:
            raise SystemExit("template: a template literal spans lines; "
                             "line-leading comment stripping is no longer safe")
        body = LEAD_BLOCK.sub("", body)
        body = LEAD_LINE.sub("", body)
        return m.group(1) + BLANKS.sub("\n\n", body) + m.group(3)

    return re.sub(r"(<script>)(.*?)(</script>)", clean, html, flags=re.S)


def data_through(site):
    """The last moment both the tide and the current tables cover, as prose."""
    d = json.load(open(os.path.join(L.ROOT, "data", site["slug"] + ".json")))
    end = min(d["tideStart"] + sum(d["tideDt"]), d["curStart"] + sum(d["curDt"]))
    stamp = datetime.datetime.fromtimestamp(end * 60, NY)
    return f"{stamp.day}&nbsp;{stamp:%b}&nbsp;{stamp.year}"


def name_phrase(site):
    """The launch's name as the title writes it, keeping any leading article."""
    m = re.search(r"Near (.+), [A-Z]{2}\b", site["title"])
    return m.group(1) if m else site["name"]


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
        # The name as it reads inside a sentence, article and all. A few places
        # take one - "the grid covering the Upper West Side" - and the title is
        # already the one field that has to get this right, so read it from
        # there rather than keep a second spelling in step with the first.
        "NAME_PHRASE": name_phrase(site),
        # What the baked predictions actually reach, read off the data rather
        # than written down: the window rolls forward every month and a hand-
        # typed date would start lying the first time it moved.
        "DATA_THROUGH": data_through(site),
        "TIDE_LABEL": tide["label"], "CURRENT_LABEL": cur["label"],
        "COORD_LABEL": f'computed for {site["lat"]:.2f}°N {abs(site["lon"]):.2f}°W',
        "UPRIVER": cur["upriverTo"], "DOWNRIVER": cur["downriverTo"],
        # the same eight-point words the script uses, for the static markup
        "UP_DIR": dir_word(cur["floodToward"]), "DOWN_DIR": dir_word(cur["ebbToward"]),
        "CURRENT_NOTE": cur["note"], "TIDE_NOTE": tide["note"], "MARSH_NOTE": marsh_note,
        "TIDE_CARD_NOTE": tide["cardNote"],
        "NWS_LABEL": "NWS " + site["nws"]["grid"].split("/")[0],
        "CURRENT_LINK": cur["link"],
        **water_fields(site),
        # built from the station this launch actually uses, rather than the one
        # the first launch happened to use
        "TIDE_LINK": ("https://tidesandcurrents.noaa.gov/stationhome.html?id="
                      + tide["station"]),
        "NWS_LINK": f'https://forecast.weather.gov/MapClick.php?lat={site["lat"]}&amp;lon={site["lon"]}',
        "LOCNAV": locnav(site, sites),
        "TIP": tip(),
        "CREDIT": L.CREDIT,
        "FEEDBACK_LINE": L.FEEDBACK_LINE,
        "FEEDBACK_USER": L.FEEDBACK_USER,
        "SITE_DOMAIN": L.DOMAIN,
        # the visible fallback, unharvestable, for before the script runs
        "SITE_DOMAIN_WORDS": L.DOMAIN.replace(".", " dot "),
        "OWNER": L.OWNER,
        "YEAR": datetime.date.today().year,
        **hero(site),
    }
    for token, value in fields.items():
        html = html.replace("{{" + token + "}}", str(value))

    html = strip_comments(html)

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
<link rel="preconnect" href="https://waterservices.usgs.gov" crossorigin>
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
    """The colour variables, lifted from the page template so the small pages
    share them rather than keeping a second copy that drifts."""
    return template[template.index(":root{"):template.index("*{box-sizing:border-box}")].rstrip()


def write_thanks():
    """Where Stripe sends someone after they pay.

    Left to itself it drops them on a generic receipt, which is a cold end to
    the one moment somebody feels warmly about the site. noindex, because a
    post-payment page has nothing to offer a search result and has no business
    being findable without paying."""
    path = os.path.join(L.ROOT, "thanks.html")
    if not L.TIP_URL:
        if os.path.exists(path):
            os.remove(path)
        return
    template = open(TEMPLATE).read()
    photo = (f'<img src="{L.TIP_PHOTO}" alt="{L.TIP_PHOTO_ALT}" width="224" height="224">'
             if L.TIP_PHOTO else "")
    page = ("""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Thank you &mdash; Hudson River Paddling Conditions</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#eaeeee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1518" media="(prefers-color-scheme: dark)">
<link rel="icon" href="__FAVICON__">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap">
<style>
__THEME__
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0; background:var(--ground); color:var(--ink);
  font-family:"Barlow","Helvetica Neue",Helvetica,Arial,sans-serif; font-size:16px; line-height:1.55;
  display:flex; align-items:center; justify-content:center; min-height:100vh; min-height:100dvh}
.wrap{max-width:440px; padding:32px 20px 48px; text-align:center}
img{width:104px; height:104px; border-radius:50%; object-fit:cover;
  border:1px solid var(--line); margin-bottom:20px}
h1{font-family:"Barlow Semi Condensed",sans-serif; font-weight:700; font-size:36px;
  line-height:1.1; margin:0 0 14px; letter-spacing:-.01em}
p{margin:0 0 14px; color:var(--ink-2); font-size:16px}
.sig{color:var(--muted); font-size:15px}
.back{margin-top:26px; padding-top:18px; border-top:1px solid var(--line);
  font-size:14px; color:var(--muted)}
.back a{color:var(--river); text-decoration:none; font-weight:500}
.back a:hover{text-decoration:underline}
</style>
</head>
<body>
  <div class="wrap">
    __PHOTO__
    <h1>Thank you!</h1>
    <p>It&rsquo;s very kind of you to support this site.</p>
    <p>See you on the river!</p>
    <p class="sig">~ Dan</p>
    <p class="back"><a href="/">Back to home</a></p>
  </div>
</body>
</html>
""".replace("__FAVICON__", FAVICON)
        .replace("__THEME__", theme_css(template))
        .replace("__PHOTO__", photo))
    with open(path, "w") as f:
        f.write(page)
    print(f"  {'Thanks':14} -> {'/thanks.html':30} {max(1, len(page.encode()) // 1024)} KB")


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
        write_thanks()
        write_cname()


if __name__ == "__main__":
    main()
