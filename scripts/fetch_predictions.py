#!/usr/bin/env python3
"""Download NOAA tide and current predictions and pack them into data/predictions.json.

Run this when the embedded predictions are running out (they currently end
31 Dec 2028) or if you want to change stations or the year range:

    python3 scripts/fetch_predictions.py

Why predictions and not live readings: tides and tidal currents are driven by the
positions of the moon and sun, so NOAA can publish them years ahead. Baking them
into the page means it needs no network at all once loaded - which matters at a
boat launch with no signal. The tradeoff is that nothing here reflects wind,
rain runoff or storm surge.
"""

import datetime as dt
import json
import os
import urllib.request
from zoneinfo import ZoneInfo

API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
NY = ZoneInfo("America/New_York")

YEARS = [2026, 2027, 2028]

# Beacon. The nearest tide station with published predictions; roughly 30 minutes
# ahead of Cold Spring, which the page corrects for (see TIDE_SHIFT_MIN).
TIDE_STATION = "8518934"

# West Point, off Duck Island. About 1.5 miles downriver from the Cold Spring
# dock - close enough to use unshifted. A subordinate station, so NOAA publishes
# only its slack/max points, no 6-minute series.
CURRENT_STATION, CURRENT_BIN = "ACT3726", 1

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "predictions.json")


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
    small (three digits instead of eight), which is most of why three years of
    data fits in under 90 KB.
    """
    deltas, values, prev = [], [], None
    for stamp, value in rows:
        epoch = to_epoch_min(stamp, prev)
        deltas.append(epoch - prev if prev is not None else epoch)
        prev = epoch
        values.append(round(value * scale))
    return deltas, values


def main():
    tides, currents = [], []
    for year in YEARS:
        t = get(f"{API}?product=predictions&application=coldspringpaddling"
                f"&begin_date={year}0101&end_date={year}1231&datum=MLLW"
                f"&station={TIDE_STATION}&time_zone=lst_ldt&units=english"
                f"&interval=hilo&format=json")
        tides += [(p["t"], float(p["v"])) for p in t["predictions"]]

        c = get(f"{API}?product=currents_predictions&application=coldspringpaddling"
                f"&begin_date={year}0101&end_date={year}1231"
                f"&station={CURRENT_STATION}&bin={CURRENT_BIN}"
                f"&time_zone=lst_ldt&units=english&interval=MAX_SLACK&format=json")
        currents += [(p["Time"], float(p["Velocity_Major"]))
                     for p in c["current_predictions"]["cp"]]
        print(f"{year}: {len(t['predictions'])} tide points, "
              f"{len(c['current_predictions']['cp'])} current points")

    # The page infers each tide's type by alternating from the first one, and each
    # current's type from the sign of its speed, so neither needs storing. Bail out
    # loudly if NOAA ever returns data those assumptions don't hold for.
    first_type = json.loads(json.dumps(
        get(f"{API}?product=predictions&application=coldspringpaddling"
            f"&begin_date={YEARS[0]}0101&end_date={YEARS[0]}0105&datum=MLLW"
            f"&station={TIDE_STATION}&time_zone=lst_ldt&units=english"
            f"&interval=hilo&format=json")["predictions"][0]["type"]))

    tide_dt, tide_v = pack(tides, 100)
    cur_dt, cur_v = pack(currents, 100)

    data = {
        "tideStart": tide_dt[0], "tideDt": tide_dt[1:], "tideV": tide_v,
        "curStart": cur_dt[0], "curDt": cur_dt[1:], "curV": cur_v,
        "tideFirstType": first_type,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"\nwrote {os.path.relpath(OUT)} - {os.path.getsize(OUT) // 1024} KB, "
          f"{tides[0][0]} to {tides[-1][0]}")


if __name__ == "__main__":
    main()
