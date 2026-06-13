#!/usr/bin/env python3
"""
Somerville sewer + street data merge.
Base spine = street centerlines. Each street segment gets annotated with:
  - sewer_type:  combined / separated / unknown   (nearest sanitary or storm main)
  - catchment:   which sewer subsystem it drains to
  - n_manholes:  sewer + storm manholes within 15 m
  - n_inlets:    storm inlets within 15 m
  - pipe_year:   install year of the nearest sanitary main (if known)
Output: out/merged_streets.geojson  (+ out/summary.json)
WGS84 in/out; distance math in UTM 19N (EPSG:32619).
"""
import json, geopandas as gpd, pandas as pd
from pathlib import Path

DATA = Path("../data"); OUT = Path("out"); OUT.mkdir(exist_ok=True)
UTM = 32619

def load(name): return gpd.read_file(DATA / f"{name}.geojson").to_crs(UTM)

print("loading layers...")
streets = load("street_centerlines")
san     = load("sanitary_mains")
storm   = load("storm_mains")
subs    = load("sewer_subsystems")
ss_mh   = load("ss_manholes"); sw_mh = load("sw_manholes")
inlets  = load("storm_inlets")

streets = streets.reset_index(drop=True)
streets["sid"] = streets.index

# --- field detection (casing differs across layers) ---
def col(df, *cands):
    for c in cands:
        if c in df.columns: return c
    return None
wt_san = col(san, "WATERTYPE", "WaterType")
combined = san[san[wt_san].astype(str).str.strip().str.lower() == "combined"]
print(f"  combined mains: {len(combined)} / {len(san)} sanitary")

# --- 1. nearest main → sewer_type ---
near_comb = gpd.sjoin_nearest(streets[["sid","geometry"]], combined[["geometry"]],
                              max_distance=20, how="left", distance_col="d_comb")
has_comb = set(near_comb.loc[near_comb["d_comb"].notna(), "sid"])
near_storm = gpd.sjoin_nearest(streets[["sid","geometry"]], storm[["geometry"]],
                               max_distance=20, how="left", distance_col="d_storm")
has_storm = set(near_storm.loc[near_storm["d_storm"].notna(), "sid"])
def sewer_type(sid):
    if sid in has_comb: return "combined"
    if sid in has_storm: return "separated"
    return "unknown"
streets["sewer_type"] = streets["sid"].map(sewer_type)

# --- 2. catchment (street midpoint in subsystem polygon) ---
tname = col(subs, "SumTribIn", "TRIB_NAME", "NUMBER")
mids = streets.copy(); mids["geometry"] = streets.geometry.interpolate(0.5, normalized=True)
cj = gpd.sjoin(mids[["sid","geometry"]], subs[[tname,"geometry"]], how="left", predicate="within")
cmap = cj.drop_duplicates("sid").set_index("sid")[tname]
streets["catchment"] = streets["sid"].map(cmap).fillna("—")

# --- 3. manhole / inlet counts within 15 m ---
buf = streets[["sid","geometry"]].copy(); buf["geometry"] = buf.geometry.buffer(15)
allmh = pd.concat([ss_mh[["geometry"]], sw_mh[["geometry"]]], ignore_index=True)
allmh = gpd.GeoDataFrame(allmh, crs=streets.crs)
mh = gpd.sjoin(allmh, buf, how="inner", predicate="within").groupby("sid").size()
inl = gpd.sjoin(inlets[["geometry"]], buf, how="inner", predicate="within").groupby("sid").size()
streets["n_manholes"] = streets["sid"].map(mh).fillna(0).astype(int)
streets["n_inlets"]   = streets["sid"].map(inl).fillna(0).astype(int)

# --- 4. nearest sanitary main install year ---
yr = col(san, "INSTALLDAT", "INSTALLDATE")
if yr:
    san["_yr"] = pd.to_numeric(san[yr].astype(str).str.extract(r"((?:18|19|20)\d{2})")[0], errors="coerce")
    nj = gpd.sjoin_nearest(streets[["sid","geometry"]], san[["_yr","geometry"]], max_distance=20, how="left")
    ymap = nj.dropna(subset=["_yr"]).drop_duplicates("sid").set_index("sid")["_yr"]
    streets["pipe_year"] = streets["sid"].map(ymap)

# --- street name ---
sn = col(streets, "Street", "STREETNAME", "STREET_NAM")
streets["street_name"] = streets[sn] if sn else "—"

keep = ["sid","street_name","sewer_type","catchment","n_manholes","n_inlets"]
if "pipe_year" in streets: keep.append("pipe_year")
out = streets[keep + ["geometry"]].to_crs(4326)
out.to_file(OUT / "merged_streets.geojson", driver="GeoJSON")

summary = {
  "street_segments": int(len(streets)),
  "by_sewer_type": streets["sewer_type"].value_counts().to_dict(),
  "by_catchment": streets["catchment"].value_counts().to_dict(),
  "avg_manholes_per_segment": round(float(streets["n_manholes"].mean()),2),
  "total_inlets_attached": int(streets["n_inlets"].sum()),
}
json.dump(summary, open(OUT / "summary.json","w"), indent=2)
print("\n=== MERGE SUMMARY ===")
print(json.dumps(summary, indent=2))
print(f"\nwrote {OUT/'merged_streets.geojson'}")
