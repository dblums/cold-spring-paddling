"""Shared loader for the launch-site registry in locations/."""
import glob
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")
DIR = os.path.join(ROOT, "locations")

# The public home of the site, declared once because four things need it: the
# CNAME file GitHub Pages reads to know which name to answer to, and the
# canonical, og:url and sitemap entries on every page. Change it here only.
DOMAIN = "hudsonconditions.com"
SITE_URL = "https://" + DOMAIN


def load():
    """Every launch site, root site first, then alphabetical by name."""
    sites = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(DIR, "*.json")))]
    if not sites:
        raise SystemExit("no locations found in locations/")
    roots = [s for s in sites if s.get("root")]
    if len(roots) != 1:
        raise SystemExit(f"exactly one location must set \"root\": true, found {len(roots)}")
    sites.sort(key=lambda s: (not s.get("root"), s["name"]))
    return sites


def out_dir(site):
    """Where a site's page is written. The root site keeps the bare URL it
    already has; everything else gets its own directory so the URLs stay clean
    as more of the river is added."""
    return ROOT if site.get("root") else os.path.join(ROOT, site["slug"])


def href(site, from_site):
    """Link from one page to another, as a relative path."""
    if site["slug"] == from_site["slug"]:
        return "."
    if from_site.get("root"):
        return site["slug"] + "/"
    return "../" if site.get("root") else "../" + site["slug"] + "/"
