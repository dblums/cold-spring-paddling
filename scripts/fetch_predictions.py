#!/usr/bin/env python3
"""Download NOAA tide and current predictions for every launch site.

    python3 scripts/fetch_predictions.py            # all sites
    python3 scripts/fetch_predictions.py beacon     # just one

Run this when the embedded predictions are running out (they currently end
31 Dec 2028), when you add a launch site, or if you change stations.

Why predictions and not live readings: tides and tidal currents are driven by
the positions of the moon and sun, so NOAA can publish them years ahead. Baking
them into the page means it needs no network at all once loaded - which matters
at a boat launch with no signal. The tradeoff is that nothing here reflects
wind, rain runoff or storm surge.
"""

import datetime as dt
import json
import os
import sys
import urllib.request
from zoneinfo import ZoneInfo

import locations as L

API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
NY = ZoneInfo("America/New_York")
YEARS = [2026, 2027, 2028]


def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def to_epoch_min(stamp, prev):
    """'YYYY-MM-DD HH:MM' in Eastern wall-clock -> minutes since the Unix epoch.

    Doing the timezone conversion here, once, means the page itself only ever
    deals in absolute time and never has to think about DST. The `prev` argument
    resolves the ambiguous hour each November: predictions are strictly
    increasing, so if the first reading lands at or before the previous one we
    must be on the second pass through that hour (fold=1).
    """
    naive = dt.datetime.strptime(stamp, "%Y-%m-%d %H:%M")
    first = int(naive.replace(tzinfo=NY, fold=0).timestamp() // 60)
    if prev is not None and first <= prev:
        second = int(naive.replace(tzinfo=NY, fold=1).timestamp() // 60)
        if second > prev:
            return second
    return first


def pack(rows, scale):
    """Delta-encode times and scale values to integers.

    Storing gaps between events rather than absolute timestamps keeps the numbers
    small - three digits instead of eight - which is most of why three years of
    data fits in under 90 KB.
    """
    deltas, values, prev = [], [], None
    for stamp, value in rows:
        epoch = to_epoch_min(stamp, prev)
        deltas.append(epoch - prev if prev is not None else epoch)
        prev = epoch
        values.append(round(value * scale))
    return deltas, values


def fetch_site(site):
    tide_st = site["tide"]["station"]
    cur_st, cur_bin = site["current"]["station"], site["current"]["bin"]
    tides, currents, first_type = [], [], None

    for year in YEARS:
        t = get(f"{API}?product=predictions&application=hudsonpaddling"
                f"&begin_date={year}0101&end_date={year}1231&datum=MLLW&station={tide_st}"
                f"&time_zone=lst_ldt&units=english&interval=hilo&format=json")
        if first_type is None:
            first_type = t["predictions"][0]["type"]
        tides += [(p["t"], float(p["v"])) for p in t["predictions"]]

        c = get(f"{API}?product=currents_predictions&application=hudsonpaddling"
                f"&begin_date={year}0101&end_date={year}1231&station={cur_st}&bin={cur_bin}"
                f"&time_zone=lst_ldt&units=english&interval=MAX_SLACK&format=json")
        currents += [(p["Time"], float(p["Velocity_Major"]))
                     for p in c["current_predictions"]["cp"]]
        print(f"    {year}: {len(t['predictions'])} tide, "
              f"{len(c['current_predictions']['cp'])} current")

    # The page infers each tide's type by alternating from the first, and each
    # current's type from the sign of its speed. Fail loudly rather than ship a
    # page built on assumptions the data no longer supports.
    for i in range(1, len(tides)):
        if tides[i][0] <= tides[i - 1][0]:
            raise SystemExit(f"{site['slug']}: tide times are not increasing at {tides[i][0]}")
    for i in range(1, len(currents)):
        if currents[i][0] <= currents[i - 1][0]:
            raise SystemExit(f"{site['slug']}: current times are not increasing at {currents[i][0]}")

    tide_dt, tide_v = pack(tides, 100)
    cur_dt, cur_v = pack(currents, 100)
    return {
        "tideStart": tide_dt[0], "tideDt": tide_dt[1:], "tideV": tide_v,
        "curStart": cur_dt[0], "curDt": cur_dt[1:], "curV": cur_v,
        "tideFirstType": first_type,
    }


def main():
    wanted = set(sys.argv[1:])
    sites = [s for s in L.load() if not wanted or s["slug"] in wanted]
    if wanted and not sites:
        raise SystemExit(f"no launch site matches {', '.join(wanted)}")
    os.makedirs(os.path.join(L.ROOT, "data"), exist_ok=True)
    for site in sites:
        print(f"{site['name']}  tide {site['tide']['station']}  "
              f"current {site['current']['station']}_{site['current']['bin']}")
        data = fetch_site(site)
        path = os.path.join(L.ROOT, "data", site["slug"] + ".json")
        with open(path, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"    wrote data/{site['slug']}.json - {os.path.getsize(path) // 1024} KB\n")


if __name__ == "__main__":
    main()
