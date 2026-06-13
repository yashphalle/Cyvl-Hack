# Somerville Sewer × Street — Data Foundation

A merged, queryable base layer combining the City of Somerville sewer GIS with the
street network. Build business ideas on top of `out/merged_streets.geojson`.

## Architecture

```
cyvl_somerville/
├── ../data/                     raw Somerville GIS (11 GeoJSON layers, public)
│     sanitary_mains · storm_mains · sewer_subsystems · ss/sw_manholes
│     storm_inlets · storm_discharge_points · street_centerlines · sidewalks · mwra_*
│
├── merge.py                     THE PIPELINE
│     load layers ─► reproject to UTM 19N (metric) ─► spatial-join sewer→streets
│     ─► annotate each street ─► reproject to WGS84 ─► write merged output
│
├── out/
│   ├── merged_streets.geojson   THE FOUNDATION  (2,272 street segments, annotated)
│   └── summary.json             merge stats
│
└── viewer.html                  Leaflet map of the foundation (opens standalone, offline)
```

## Data flow

raw GIS layers  →  `merge.py` (geopandas; distance math in EPSG:32619)  →
`merged_streets.geojson` (EPSG:4326)  →  `viewer.html` / any business app

## The merged schema (one row per street segment)

| field | meaning | source |
|---|---|---|
| `sid` | stable segment id | generated |
| `street_name` | street name | street_centerlines |
| `sewer_type` | combined / separated / unknown | nearest sanitary vs storm main (≤20 m) |
| `catchment` | sewer subsystem it drains to (A, CA, C1, C2, S1, S2, M) | point-in-polygon, sewer_subsystems |
| `n_manholes` | sewer+storm manholes within 15 m | spatial count |
| `n_inlets` | storm inlets within 15 m | spatial count |
| `pipe_year` | install year of nearest sanitary main | INSTALLDAT regex |

Current foundation: **1,810 combined · 390 separated · 72 unknown**; avg 4.45 manholes/segment; 8,037 inlet attachments.

## How to extend it for a business idea

`merged_streets.geojson` is the join key — every idea adds columns to it:

- **Add Cyvl condition** (pavement score, distresses, ramps) — join Cyvl features to `sid`
  by location via the MCP or the spatial SDK, write new columns.
- **Add measurement** (cyvl-spatial-sdk) — `cyvl.measure()` / `unproject()` to attach
  real-world geometry (ramp slope, sidewalk width, clearances) per segment.
- **Add external** — 311, crashes, ACS, etc., spatial-joined the same way.

The merge is idempotent — re-run `python3 merge.py` after changing inputs.

## Run

```bash
python3 merge.py          # rebuild out/merged_streets.geojson
open viewer.html          # view the foundation
```
Requires geopandas (installed with cyvl-spatial-sdk).
