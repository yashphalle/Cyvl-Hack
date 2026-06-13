"""
Offline scoring script — run once to produce data/scored_streets.geojson.
Joins sewer pipe data with Cyvl pavement/asset data and computes a
0-100 readiness score per combined sewer segment.

Factors and weights:
  F1 pavement urgency  28%
  F2 pipe age          22%
  F3 dig cost          18%
  F4 bundling assets   12%
  F5 network leverage   8%
  F6 water co-risk     12%
  + catch basin bonus  up to +5 pts (on top of weighted score)
"""
import json
import math
from pathlib import Path
from shapely.geometry import shape, Point, LineString
from shapely.strtree import STRtree

DATA  = Path(__file__).parent.parent / "data"
CYVL  = Path(__file__).parent.parent / "cyvl_data"
SEWER = Path(__file__).parent.parent / "public" / "data" / "sewer"
OUT   = DATA / "scored_streets.geojson"

WATER_RISK_SCORE = {
    "Failing":                 1.0,
    "High Risk":               0.7,
    "Maintenance & Monitoring": 0.3,
    "Low Risk":                0.0,
}

# ── helpers ──────────────────────────────────────────────────────────────────

def load(path):
    return json.loads(Path(path).read_text())["features"]

def epoch_to_year(ms):
    if ms is None or ms == 0:
        return None
    return 1970 + int(ms / 1000 / 60 / 60 / 24 / 365.25)

def normalize(val, lo, hi):
    if hi == lo:
        return 0.5
    return max(0.0, min(1.0, (val - lo) / (hi - lo)))

# ── load data ─────────────────────────────────────────────────────────────────

print("Loading sewer pipes...")
all_pipes = load(DATA / "ss_gravity_mains.geojson")
combined  = [f for f in all_pipes if f["properties"].get("WATERTYPE") == "Combined"]
print(f"  {len(combined)} combined segments")

print("Loading Cyvl data...")
pave_feats  = load(CYVL / "factors" / "factor1_pavement.geojson")
asset_feats = load(CYVL / "factors" / "factor4_bundling_assets.geojson")
img_feats   = load(CYVL / "factors" / "evidence_imagery.geojson")

print("Loading water pipe risk...")
water_risk_feats = load(SEWER / "water_pipe_risk.geojson")
print(f"  {len(water_risk_feats)} water pipe risk segments")

print("Loading storm inlets (catch basins)...")
inlet_feats = load(SEWER / "storm_inlets.geojson")
print(f"  {len(inlet_feats)} storm inlets")

# ── spatial indices ───────────────────────────────────────────────────────────

print("Building spatial indices...")

pave_geoms       = [shape(f["geometry"]) for f in pave_feats]
pave_tree        = STRtree(pave_geoms)

asset_geoms      = [shape(f["geometry"]).centroid for f in asset_feats]
asset_tree       = STRtree(asset_geoms)

img_geoms        = [shape(f["geometry"]).centroid for f in img_feats]
img_tree         = STRtree(img_geoms)

water_risk_geoms = [shape(f["geometry"]) for f in water_risk_feats]
water_risk_tree  = STRtree(water_risk_geoms)

inlet_feats = [f for f in inlet_feats if f.get("geometry")]
inlet_geoms = [shape(f["geometry"]) for f in inlet_feats]
inlet_tree  = STRtree(inlet_geoms)

# ── network topology for Factor 5 ─────────────────────────────────────────────

separated_mh = {
    f["properties"].get("FROMMH")
    for f in all_pipes
    if f["properties"].get("WATERTYPE") in ("Storm", "Sewage")
} | {
    f["properties"].get("TOMH")
    for f in all_pipes
    if f["properties"].get("WATERTYPE") in ("Storm", "Sewage")
}

# ── score each segment ────────────────────────────────────────────────────────

SEARCH_DEG = 0.0005   # ~50m in degrees

print("Scoring segments...")
features_out = []

for feat in combined:
    props = feat["properties"]
    geom  = feat["geometry"]

    try:
        line = shape(geom)
        mid  = line.interpolate(0.5, normalized=True)
    except Exception:
        continue

    buf = mid.buffer(SEARCH_DEG)

    # ── F1 (28%): pavement urgency — low PCI = high score ────────────────────
    nearby_pave = pave_tree.query(buf)
    if len(nearby_pave) > 0:
        pcis = [pave_feats[i]["properties"].get("pci_score", 75) for i in nearby_pave]
        avg_pci = sum(pcis) / len(pcis)
    else:
        avg_pci = 75
    f1 = 1.0 - normalize(avg_pci, 0, 100)

    # ── F2 (22%): pipe age — older = higher score ────────────────────────────
    install_ms = props.get("INSTALLDAT")
    install_yr = epoch_to_year(install_ms)
    if install_yr:
        f2 = normalize(2026 - install_yr, 0, 150)
    else:
        f2 = 0.5

    # ── F3 (18%): dig cost — shallower is cheaper ────────────────────────────
    up    = props.get("UpstreamIn") or 0
    down  = props.get("Downstream") or 0
    # 9999 is a sentinel meaning no data — treat as missing
    up    = 0 if up   == 9999 else up
    down  = 0 if down == 9999 else down
    depth = max(up, down)
    if depth > 0:
        f3 = 1.0 - normalize(depth, 0, 30)
    else:
        f3 = 1.0 - normalize(20, 0, 30)  # assume 20ft default when unknown

    # ── F4 (12%): bundling value — more assets nearby = higher score ──────────
    nearby_assets = asset_tree.query(buf)
    asset_count = len(nearby_assets)
    f4 = normalize(asset_count, 0, 15)

    # ── F5 (8%): network leverage — connects separated segments ───────────────
    from_mh = props.get("FROMMH", "")
    to_mh   = props.get("TOMH", "")
    connected_sep = sum([
        1 if from_mh in separated_mh else 0,
        1 if to_mh   in separated_mh else 0,
    ])
    f5 = connected_sep / 2.0

    # ── F6 (12%): water co-risk — failing water main = dig-once opportunity ───
    nearby_water = water_risk_tree.query(buf)
    water_quad = "None"
    f6 = 0.0
    if len(nearby_water) > 0:
        quads = [water_risk_feats[i]["properties"].get("RiskQuad", "Low Risk")
                 for i in nearby_water]
        f6 = max(WATER_RISK_SCORE.get(q, 0.0) for q in quads)
        # report the worst quad found nearby
        for tier in ("Failing", "High Risk", "Maintenance & Monitoring", "Low Risk"):
            if tier in quads:
                water_quad = tier
                break

    # ── weighted score 0–100 ─────────────────────────────────────────────────
    score = round(
        (f1 * 0.28 + f2 * 0.22 + f3 * 0.18 + f4 * 0.12 + f5 * 0.08 + f6 * 0.12) * 100,
        1,
    )

    # ── catch basin bonus: up to +5 pts ──────────────────────────────────────
    # Each storm inlet within 50m needs to be physically rerouted during separation.
    # 3+ inlets = full bonus, scales linearly below that.
    nearby_inlets = len(inlet_tree.query(buf))
    cb_bonus = round(min(5.0, nearby_inlets * (5.0 / 3)), 1)
    score = min(100.0, round(score + cb_bonus, 1))

    # ── nearest evidence image ────────────────────────────────────────────────
    nearby_imgs = img_tree.query(buf)
    image_url = None
    if len(nearby_imgs) > 0:
        image_url = img_feats[nearby_imgs[0]]["properties"].get("image_url")

    install_year_out = install_yr or "Unknown"
    diameter = props.get("Diameter") or props.get("Width") or 0

    features_out.append({
        "type": "Feature",
        "geometry": geom,
        "properties": {
            "id":               props.get("FACILITYID", props.get("OBJECTID")),
            "street_name":      props.get("Streetname", ""),
            "water_type":       props.get("WATERTYPE"),
            "score":            score,
            "pci":              round(avg_pci, 1),
            "install_year":     install_year_out,
            "pipe_age":         2026 - install_yr if install_yr else None,
            "diameter_in":      diameter,
            "material":         props.get("Material", ""),
            "depth_ft":         round(depth, 1) if depth else None,
            "asset_count":      asset_count,
            "network_leverage": connected_sep,
            "water_risk_quad":  water_quad,
            "catch_basin_count": nearby_inlets,
            "catch_basin_bonus": cb_bonus,
            "image_url":        image_url,
            "from_mh":          from_mh,
            "to_mh":            to_mh,
            # factor breakdown
            "f1_pavement":      round(f1 * 100, 1),
            "f2_age":           round(f2 * 100, 1),
            "f3_depth":         round(f3 * 100, 1),
            "f4_bundling":      round(f4 * 100, 1),
            "f5_network":       round(f5 * 100, 1),
            "f6_water_risk":    round(f6 * 100, 1),
        },
    })

features_out.sort(key=lambda f: f["properties"]["score"], reverse=True)

fc = {"type": "FeatureCollection", "features": features_out}
OUT.write_text(json.dumps(fc))
print(f"\nDone — {len(features_out)} segments → {OUT}")
scores = [f["properties"]["score"] for f in features_out]
print(f"Score range: {min(scores):.1f} – {max(scores):.1f}, avg: {sum(scores)/len(scores):.1f}")

# water risk breakdown
from collections import Counter
wq = Counter(f["properties"]["water_risk_quad"] for f in features_out)
print("Water risk distribution across combined pipes:")
for k, v in wq.most_common():
    print(f"  {k:30s} {v}")
