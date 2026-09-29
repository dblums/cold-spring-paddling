"""Shared loader for the launch-site registry in locations/."""
import glob
import json
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")
DIR = os.path.join(ROOT, "locations")

# The public home of the site, declared once because several things need it: the
# CNAME file GitHub Pages reads to know which name to answer to, and the
# canonical, og:url and sitemap entries on every page. Change it here only.
DOMAIN = "hudsonconditions.com"
SITE_URL = "https://" + DOMAIN

OWNER = "Modern Product Minds LLC"
CREDIT = "Site and photos by Dan Blumberg."
FEEDBACK_LINE = ("Feedback? Something you wish this site had? Want to paddle? Email me:")
# A forwarding alias on our own domain, not a personal address. If it ever gets
# harvested and buried in spam, delete it and make another - nothing downstream
# has to change, and no real inbox was ever published. Set it up under
# Dynadot -> Email Settings; ten of them come free with the domain.
FEEDBACK_USER = "hello"

# A Stripe Payment Link in "customers choose what to pay" mode. Empty means the
# nudge is not rendered at all, so the page never shows a dead button.
TIP_URL = "https://buy.stripe.com/cNicN68Q15RF97rbVU1wY00"
TIP_LINE = ("Hi, I&rsquo;m Dan! I built this site because I paddle on the Hudson with my "
            "family (that&rsquo;s my 10-year-old son I&rsquo;m towing through a rainstorm "
            "on our way from Cold Spring to Beacon). The site is free. If you find it "
            "helpful and want to support it, you can buy me a coffee.")
TIP_CTA = "Buy me a coffee"
TIP_PHOTO = "dan-blumberg.jpg"
TIP_PHOTO_ALT = ("Dan Blumberg in a life jacket and cap, grinning in the rain on the Hudson, "
                 "towing a second kayak behind his own")


# Every NOAA CO-OPS station on the tidal Hudson that reports water temperature,
# with its river mile. There is no sensor at any of our launches, so each page
# takes the nearest one above and below it and interpolates. Coxsackie matters:
# without it, anything north of Turkey Point has nothing upriver to bracket
# against. Check for new stations when adding a launch outside this range.
WATER_STATIONS = [
    {"id": "8518750", "name": "The Battery",  "mile": 0},
    {"id": "8518962", "name": "Turkey Point", "mile": 100},
    {"id": "8518979", "name": "Coxsackie",    "mile": 126},
]


# Interpolating only earns its keep across a real gradient. Measured over
# spring 2026: The Battery to Turkey Point is +3.1F mean over 100 river miles
# (range -0.5 to +6.6), so Cold Spring at mile 54 genuinely sits between two
# different temperatures. Turkey Point to Coxsackie is under 1F over 26 miles,
# so interpolating for Hudson moves the answer 0.3F - far less than the
# difference between mid-channel and the shallows at the launch itself. Past
# this distance, use the nearest station and say which one it is.
NEAR_MILES = 12


def water_pair(site):
    """The stations a launch's temperature comes from, downriver first.

    Returns (south, north). Either may be None: at the ends of the river there
    is nothing to bracket against, and when a station is within NEAR_MILES the
    other is dropped deliberately rather than averaged into false precision.

    The near-station tiebreak favours the upriver one. In spring - the season
    where water temperature actually decides what you wear - Coxsackie ran a
    mean 0.76F colder than Turkey Point and was the colder of the two on 70% of
    days, so when the two are equally close, upriver is the safer read."""
    mile = site["riverMile"]
    below = [s for s in WATER_STATIONS if s["mile"] <= mile]
    above = [s for s in WATER_STATIONS if s["mile"] > mile]
    south = max(below, key=lambda s: s["mile"]) if below else None
    north = min(above, key=lambda s: s["mile"]) if above else None
    near = [s for s in (north, south) if s and abs(s["mile"] - mile) <= NEAR_MILES]
    if near:
        pick = near[0]          # north first in the list, so upriver wins a tie
        return (None, pick) if pick is north else (pick, None)
    return south, north


def load():
    """Every launch site, the primary one first, then alphabetical by name."""
    sites = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(DIR, "*.json")))]
    if not sites:
        raise SystemExit("no locations found in locations/")
    primary = [s for s in sites if s.get("primary")]
    if len(primary) != 1:
        raise SystemExit(
            f'exactly one location must set "primary": true, found {len(primary)}')
    sites.sort(key=lambda s: (not s.get("primary"), s["name"]))
    return sites


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def page_slug(site):
    """The URL name for a launch, e.g. cold-spring-new-york.

    The state is in there because these pages compete for searches like
    "cold spring kayak conditions", and there is a Cold Spring in a dozen
    states. It also keeps the slugs unique once the registry crosses a border,
    which "beacon" and "newburgh" would not on their own."""
    return slugify(site["slug"]) + "-" + slugify(site["state"])


def page_file(site):
    """Filename written to the repository root, which is also the URL path."""
    return page_slug(site) + ".html"


def banner_file(site):
    """Every page sits in the same directory now, so the photos cannot all be
    called banner.jpg."""
    return page_slug(site) + ".jpg"


def page_url(site):
    return SITE_URL + "/" + page_file(site)


def href(site, from_site=None):
    """Link from one page to another. Every page is a flat file at the root, so
    this is just the filename - no ../ arithmetic to get wrong."""
    return page_file(site)
