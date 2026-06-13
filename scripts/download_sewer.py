#!/usr/bin/env python3
"""
Download Somerville sewer GIS data from the city's ArcGIS REST API.
No credentials needed — public server.
Outputs WGS84 GeoJSON files to public/data/sewer/.
"""

import json, os, sys, time, urllib.request, urllib.parse
from pathlib import Path
from pyproj import Transformer

BASE = "https://maps.somervillema.gov/arcgis/rest/services/SewerAndStormWaterSystem/MapServer"
OUT_DIR = Path(__file__).parent.parent / "public" / "data" / "sewer"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# EPSG:3857 (Web Mercator) → EPSG:4326 (WGS84 lon/lat)
to_wgs84 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

LAYERS = {
    "sanitary_mains": (
        11,
        ["OBJECTID", "WATERTYPE", "Streetname", "INSTALLDAT", "Diameter",
         "Material", "MatCode", "SLOPE", "GIS_LENGTH", "CatchArea", "FROMMH", "TOMH"],
    ),
    "storm_mains": (
        10,
        ["OBJECTID", "WaterType", "Streetname", "INSTALLDATE", "Diameter",
         "Material", "MeasuredLength", "Shape_Length"],
    ),
    "sewer_subsystems": (
        3,
        ["OBJECTID", "SubsysName", "SubsysID", "AreaAcres"],
    ),
    "sanitary_manholes": (
        8,
        ["OBJECTID", "FACILITYID", "RimElevati", "InvertElev", "Depth",
         "Material", "Diameter", "WATERTYPE"],
    ),
    "storm_manholes": (
        7,
        ["OBJECTID", "FACILITYID", "RimElevati", "InvertElev", "Depth",
         "Material", "Diameter"],
    ),
    "storm_inlets": (
        5,
        ["OBJECTID", "FacilityID", "WaterType", "Comments", "RimElevati"],
    ),
    "storm_discharge": (
        6,
        ["OBJECTID", "FACILITYID", "OutfallID", "DischargeP", "WaterBody"],
    ),
}


def fetch(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(1)


def fetch_post(url: str, params: dict, retries: int = 3) -> dict:
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(1)


def get_all_ids(layer_id: int) -> list[int]:
    url = f"{BASE}/{layer_id}/query?returnIdsOnly=true&where=OBJECTID+IS+NOT+NULL&f=json"
    d = fetch(url)
    return sorted(d.get("objectIds") or [])


def reproject_path(path: list) -> list:
    """Convert a single path ring from EPSG:3857 to WGS84."""
    result = []
    for pt in path:
        lon, lat = to_wgs84.transform(pt[0], pt[1])
        result.append([round(lon, 7), round(lat, 7)])
    return result


def esri_to_geojson_geometry(esri_geom: dict, geom_type: str) -> dict | None:
    if esri_geom is None:
        return None
    if geom_type == "esriGeometryPolyline":
        coords = [reproject_path(p) for p in esri_geom.get("paths", [])]
        return {"type": "MultiLineString", "coordinates": coords}
    elif geom_type == "esriGeometryPolygon":
        rings = [reproject_path(r) for r in esri_geom.get("rings", [])]
        return {"type": "Polygon", "coordinates": rings}
    elif geom_type == "esriGeometryPoint":
        lon, lat = to_wgs84.transform(esri_geom["x"], esri_geom["y"])
        return {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}
    return None


def download_layer(name: str, layer_id: int, fields: list[str]) -> None:
    out_path = OUT_DIR / f"{name}.geojson"
    if out_path.exists():
        print(f"  skip (exists): {name}.geojson")
        return

    print(f"  downloading layer {layer_id}: {name}")
    ids = get_all_ids(layer_id)
    print(f"    {len(ids)} features to fetch")

    fields_param = urllib.parse.quote(",".join(fields))
    batch_size = 1000
    features = []

    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        url = f"{BASE}/{layer_id}/query"
        d = fetch_post(url, {
            "objectIds": ",".join(map(str, batch)),
            "outFields": ",".join(fields),
            "f": "json",
        })

        if "error" in d:
            print(f"    ERROR: {d['error']}", file=sys.stderr)
            continue

        geom_type = d.get("geometryType", "")
        for feat in d.get("features", []):
            geom = esri_to_geojson_geometry(feat.get("geometry"), geom_type)
            props = {k: v for k, v in feat.get("attributes", {}).items()}
            features.append({"type": "Feature", "geometry": geom, "properties": props})

        pct = min(100, int((i + batch_size) / len(ids) * 100))
        print(f"    {pct}% ({len(features)} features)", end="\r")

    fc = {"type": "FeatureCollection", "features": features}
    out_path.write_text(json.dumps(fc))
    print(f"  ✓ {name}.geojson ({len(features)} features)          ")


def main():
    print(f"Output: {OUT_DIR}")
    for name, (layer_id, fields) in LAYERS.items():
        download_layer(name, layer_id, fields)
    print("\nDone.")
    for f in sorted(OUT_DIR.glob("*.geojson")):
        size_kb = f.stat().st_size / 1024
        d = json.loads(f.read_text())
        n = len(d.get("features", []))
        print(f"  {size_kb:8.0f} KB  {f.name}  ({n} features)")


if __name__ == "__main__":
    main()
