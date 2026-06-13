#!/usr/bin/env bash
# Download all data for the Sewershed project.
# No credentials needed — both sources are public.
# Run from repo root: bash scripts/download_data.sh

set -euo pipefail

CYVL_DIR="public/data/cyvl"
SEWER_DIR="public/data/sewer"
S3="https://cyvl-hackathon.s3.amazonaws.com"
ARCGIS="https://maps.somervillema.gov/arcgis/rest/services/SewerAndStormWaterSystem/MapServer"

mkdir -p "$CYVL_DIR" "$SEWER_DIR"

# ── 1. CYVL DATA (S3 public bucket) ─────────────────────────────────────────
echo ""
echo "=== Cyvl data from S3 ==="

download_cyvl() {
  local file="$1"
  local dest="$CYVL_DIR/$(basename "$file")"
  if [ -f "$dest" ]; then
    echo "  skip (exists): $dest"
  else
    echo "  downloading: $file"
    curl -sf --progress-bar -o "$dest" "$S3/$file"
    echo "  ✓ $(basename "$file")"
  fi
}

# Core layers — these are all we need for the join + scoring
download_cyvl "data/rollup_v2.geojson"              # 894 segments, pre-scored, render-ready colors
download_cyvl "data/pavements_v2.geojson"           # 5,080 scored 30-ft segments, address_st field
download_cyvl "data/aboveGroundAssets_v2.geojson"   # 8,254 assets: catch basins, manholes, ramps, etc.

# Distresses — large (74 MB) but needed for utility-cut patching stat
download_cyvl "data/distresses_v2.geojson"

# ── 2. SOMERVILLE SEWER GIS (ArcGIS REST API) ────────────────────────────────
# Each layer: query all records (WHERE 1=1), all fields, GeoJSON output.
# ArcGIS caps at 1000 records/request — we paginate with resultOffset.
echo ""
echo "=== Somerville sewer GIS from ArcGIS ==="

download_arcgis_layer() {
  local layer_id="$1"
  local name="$2"
  local dest="$SEWER_DIR/${name}.geojson"

  if [ -f "$dest" ]; then
    echo "  skip (exists): $dest"
    return
  fi

  echo "  downloading layer $layer_id: $name"

  local offset=0
  local batch=1000
  local tmp_dir
  tmp_dir=$(mktemp -d)
  local page=0

  while true; do
    local url="${ARCGIS}/${layer_id}/query?where=1%3D1&outFields=*&f=geojson&resultOffset=${offset}&resultRecordCount=${batch}"
    local page_file="$tmp_dir/page_${page}.json"
    curl -sf -o "$page_file" "$url"

    local count
    count=$(python3 -c "import json,sys; d=json.load(open('$page_file')); print(len(d.get('features', [])))")

    if [ "$count" -eq 0 ]; then
      break
    fi

    offset=$((offset + batch))
    page=$((page + 1))

    if [ "$count" -lt "$batch" ]; then
      break  # last page
    fi
  done

  # Merge all pages into one GeoJSON FeatureCollection
  python3 - "$tmp_dir" "$dest" <<'PYEOF'
import json, sys, glob, os

src_dir, out_path = sys.argv[1], sys.argv[2]
features = []
for f in sorted(glob.glob(os.path.join(src_dir, "page_*.json"))):
    d = json.load(open(f))
    features.extend(d.get("features", []))

result = {"type": "FeatureCollection", "features": features}
with open(out_path, "w") as fh:
    json.dump(result, fh)
print(f"  ✓ {os.path.basename(out_path)} ({len(features)} features)")
PYEOF

  rm -rf "$tmp_dir"
}

# Layer IDs from maps.somervillema.gov MapServer
download_arcgis_layer 11 "sanitary_mains"        # SS Gravity Mains — WATERTYPE field has "Combined"
download_arcgis_layer 10 "storm_mains"           # SW Gravity Mains
download_arcgis_layer  3 "sewer_subsystems"      # Catchment boundaries (7 subsystems)
download_arcgis_layer  8 "sanitary_manholes"     # SS Manholes
download_arcgis_layer  7 "storm_manholes"        # SW Manholes
download_arcgis_layer  5 "storm_inlets"          # Storm inlets / catch basins
download_arcgis_layer  6 "storm_discharge"       # Outfalls (27 total)

# ── 3. DONE ──────────────────────────────────────────────────────────────────
echo ""
echo "=== All done. Files on disk: ==="
ls -lh "$CYVL_DIR"
echo ""
ls -lh "$SEWER_DIR"
