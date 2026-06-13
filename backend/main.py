import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
import anthropic
import io
import csv

load_dotenv(Path(__file__).parent.parent / ".env")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATA = Path(__file__).parent.parent / "data"
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = """You are a sewer infrastructure query assistant for Sewershed, a tool that ranks combined sewer pipes in Somerville, MA by separation readiness.

The frontend has 2,404 combined sewer pipe segments already loaded. Each segment has these properties:
- score: 0–100 readiness score (higher = more urgent to separate)
- pci: pavement condition index 0–100 (lower = worse pavement)
- pipe_age: age in years (some up to 158 years old)
- install_year: year installed (e.g. 1924)
- street_name: street name (e.g. "Highland Avenue")
- material: pipe material (e.g. "Reinforced Concrete", "Clay")
- diameter_in: pipe diameter in inches
- asset_count: number of bundlable assets nearby (ramps, catch basins, sidewalks)
- network_leverage: 0, 1, or 2 (how many connected pipes are already separated)
- depth_ft: dig depth in feet
- f1_pavement, f2_age, f3_depth, f4_bundling, f5_network: individual factor scores 0–100

Available catchments: A (Alewife), C1, C2, CA, S1, S2, M (Medford)

You must respond with a single JSON object. No explanation, no markdown, just raw JSON.

Schema:
{
  "filters": {
    "priorities": { "high": true, "medium": true, "low": true },  // which priority tiers to show
    "minScore": 0,        // minimum readiness score
    "maxScore": 100,      // maximum readiness score
    "minAge": 0,          // minimum pipe age in years
    "maxAge": 999,        // maximum pipe age in years
    "minPci": 0,          // minimum PCI
    "maxPci": 100,        // maximum PCI
    "street": ""          // filter by street name (partial match, case-insensitive)
  },
  "flyTo": {
    "lng": -71.096,
    "lat": 42.3875,
    "zoom": 14
  },
  "answer": "Human-readable summary of what was found or what action was taken"
}

All keys are optional. Only include what's relevant to the query.
If you can answer a factual question without filtering (e.g. "how many pipes?"), just return an answer field.
If the query asks to show/filter something, return filters and optionally flyTo.
For street queries, fly to Somerville center and include the street name filter.
"""

def load_scored():
    path = DATA / "scored_streets.geojson"
    if not path.exists():
        raise HTTPException(500, "scored_streets.geojson not found — run scorer.py first")
    return json.loads(path.read_text())

@app.get("/api/segments")
def get_segments():
    return JSONResponse(load_scored())

@app.get("/api/segment/{feature_id}")
def get_segment(feature_id: str):
    fc = load_scored()
    for feat in fc["features"]:
        if str(feat["properties"].get("id")) == feature_id:
            return feat
    raise HTTPException(404, "Segment not found")

@app.get("/api/stats")
def get_stats():
    fc = load_scored()
    scores = [f["properties"]["score"] for f in fc["features"]]
    ages   = [f["properties"]["pipe_age"] for f in fc["features"] if f["properties"].get("pipe_age")]
    return {
        "total_segments":  len(scores),
        "avg_score":       round(sum(scores) / len(scores), 1),
        "high_priority":   sum(1 for s in scores if s >= 50),
        "medium_priority": sum(1 for s in scores if 30 <= s < 50),
        "low_priority":    sum(1 for s in scores if s < 30),
        "oldest_pipe_age": max(ages) if ages else None,
        "avg_pipe_age":    round(sum(ages) / len(ages)) if ages else None,
    }

class SearchRequest(BaseModel):
    query: str

@app.post("/api/search")
def search(req: SearchRequest):
    if not req.query.strip():
        raise HTTPException(400, "Empty query")

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": req.query}],
    )

    raw = message.content[0].text.strip()

    # strip markdown code fences if Claude wraps in them
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"answer": raw}

    return result

@app.get("/api/export/csv")
def export_csv():
    fc = load_scored()
    fields = ["id", "street_name", "score", "pci", "install_year", "pipe_age",
              "diameter_in", "material", "depth_ft", "asset_count",
              "network_leverage", "f1_pavement", "f2_age", "f3_depth",
              "f4_bundling", "f5_network"]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for feat in fc["features"]:
        writer.writerow(feat["properties"])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sewershed_scores.csv"}
    )

@app.get("/api/export/geojson")
def export_geojson():
    fc = load_scored()
    return StreamingResponse(
        iter([json.dumps(fc)]),
        media_type="application/geo+json",
        headers={"Content-Disposition": "attachment; filename=sewershed_scores.geojson"}
    )
