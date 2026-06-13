import json
import time
import urllib.request
import urllib.parse
from pathlib import Path

BASE_URL = "https://maps.somervillema.gov/arcgis/rest/services/SewerAndStormWaterSystem/MapServer"

LAYERS = [
    (11, "ss_gravity_mains"),
    (8,  "ss_manholes"),
    (10, "sw_gravity_mains"),
    (7,  "sw_manholes"),
    (3,  "sewer_subsystems"),
    (5,  "storm_inlets"),
]

PAGE_SIZE = 1000
OUT_DIR = Path("data")
OUT_DIR.mkdir(exist_ok=True)


def esri_geom_to_geojson(geom, geom_type):
    if geom is None:
        return None
    if geom_type == "esriGeometryPoint":
        return {"type": "Point", "coordinates": [geom["x"], geom["y"]]}
    if geom_type == "esriGeometryPolyline":
        paths = geom.get("paths", [])
        if len(paths) == 1:
            return {"type": "LineString", "coordinates": paths[0]}
        return {"type": "MultiLineString", "coordinates": paths}
    if geom_type == "esriGeometryPolygon":
        return {"type": "Polygon", "coordinates": geom.get("rings", [])}
    return None


def fetch_page(layer_id: int, min_objectid: int) -> dict:
    params = urllib.parse.urlencode({
        "where": f"OBJECTID > {min_objectid}",
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "resultRecordCount": PAGE_SIZE,
        "orderByFields": "OBJECTID",   # stable keyset pagination
        "f": "json",
    })
    url = f"{BASE_URL}/{layer_id}/query?{params}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read())


def fetch_layer(layer_id: int, name: str) -> dict:
    features = []
    last_oid = 0
    geom_type = None

    while True:
        print(f"  [{name}] OBJECTID>{last_oid} ...", end=" ", flush=True)
        page = fetch_page(layer_id, last_oid)

        if "error" in page:
            print(f"ERROR: {page['error']}")
            break

        geom_type = geom_type or page.get("geometryType")
        batch = page.get("features", [])

        for f in batch:
            geojson_geom = esri_geom_to_geojson(f.get("geometry"), geom_type)
            features.append({
                "type": "Feature",
                "geometry": geojson_geom,
                "properties": f.get("attributes", {}),
            })

        print(f"got {len(batch)}")
        if not batch:
            break

        last_oid = batch[-1]["attributes"]["OBJECTID"]
        if len(batch) < PAGE_SIZE:
            break
        time.sleep(0.3)

    return {"type": "FeatureCollection", "features": features}


def main():
    for layer_id, name in LAYERS:
        print(f"\nFetching layer {layer_id}: {name}")
        fc = fetch_layer(layer_id, name)
        out_path = OUT_DIR / f"{name}.geojson"
        with open(out_path, "w") as f:
            json.dump(fc, f)
        print(f"  Saved {len(fc['features'])} features → {out_path}")


if __name__ == "__main__":
    main()
