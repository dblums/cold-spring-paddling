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
