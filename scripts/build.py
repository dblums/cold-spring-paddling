#!/usr/bin/env python3
"""Assemble the deployable page from src/template.html + data + banner.

    python3 scripts/build.py

Produces two files, both fully self-contained - no external requests at all,
so the page works with no signal once it has loaded:

  index.html     the site. This is what you deploy.
  artifact.html  the same page without the <html>/<head>/<body> wrapper,
                 which is the shape Claude Artifacts expects.

Everything is inlined: the prediction data as JSON, the banner photo as a
base64 data URI. That is deliberate. A kayaker checking conditions at the
Cold Spring dock often has no usable cell service, and a single file with no
dependencies cannot half-load.
"""

import base64
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")
TEMPLATE = os.path.join(ROOT, "src", "template.html")
BANNER = os.path.join(ROOT, "src", "banner.jpg")
DATA = os.path.join(ROOT, "data", "predictions.json")

TITLE = "Hudson River Paddling Conditions Near Cold Spring, NY"
DESCRIPTION = ("Hudson River tides, current, and Constitution Marsh access windows "
               "for kayakers paddling near Cold Spring, NY.")
# A canoe emoji drawn into an SVG, so the favicon needs no separate file either.
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'"
           "%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%9B%B6%3C/text%3E%3C/svg%3E")


def build():
    html = open(TEMPLATE).read()
    predictions = open(DATA).read().strip()
    banner = "data:image/jpeg;base64," + base64.b64encode(open(BANNER, "rb").read()).decode()

    for token, value in (("{{PREDICTIONS}}", predictions), ("{{BANNER}}", banner)):
        if token not in html:
            raise SystemExit(f"template is missing {token}")
        html = html.replace(token, value, 1)

    # Claude Artifacts supplies its own document wrapper, so it gets the bare body.
    artifact = os.path.join(ROOT, "artifact.html")
    with open(artifact, "w") as f:
        f.write(html)

    # Everything else needs a real document.
    split = html.index('<div class="wrap">')
    head, body = html[:split].rstrip(), html[split:].rstrip()
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{DESCRIPTION}">
<meta name="theme-color" content="#eaeeee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1518" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Cold Spring Tides">
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
    index = os.path.join(ROOT, "index.html")
    with open(index, "w") as f:
        f.write(page)

    for path in (index, artifact):
        print(f"wrote {os.path.relpath(path, ROOT)} - {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    build()
