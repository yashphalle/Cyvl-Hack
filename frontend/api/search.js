// Vercel serverless function — natural-language search.
// Uses ANTHROPIC_API_KEY from Vercel env vars (server-side only, never shipped
// to the client). Mirrors the FastAPI /api/search route.
const SYSTEM_PROMPT = `You are a sewer infrastructure query assistant for a tool that ranks combined sewer pipes in Somerville, MA by construction criticality / separation readiness.

There are 2,404 combined sewer pipe segments already loaded. Each segment has:
- score: 0-100 readiness score (higher = more urgent)
- pci: pavement condition index 0-100 (lower = worse pavement)
- pipe_age: age in years (some up to 158)
- install_year: year installed
- street_name: street name
- material: pipe material
- diameter_in: pipe diameter in inches
- asset_count: bundlable assets nearby
- water_risk_quad: "Failing","High Risk","Maintenance & Monitoring","Low Risk","None"

Respond with a SINGLE raw JSON object, no markdown, no explanation.
Schema (all keys optional, include only what's relevant):
{
  "filters": { "priorities": {"high":true,"medium":true,"low":true}, "minScore":0, "maxScore":100, "minAge":0, "maxAge":999, "minPci":0, "maxPci":100, "street":"" },
  "flyTo": { "lng":-71.096, "lat":42.3875, "zoom":14 },
  "answer": "Human-readable summary of what was found or done"
}
If a factual question can be answered without filtering, return only an answer field.
For street queries, fly to Somerville center and include the street name filter.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ answer: "Search is offline (no API key configured)." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const query = (body && body.query ? String(body.query) : "").trim();
  if (!query) return res.status(400).json({ error: "Empty query" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: query }],
      }),
    });
    const j = await r.json();
    let raw = (j.content && j.content[0] && j.content[0].text || "").trim();
    if (raw.startsWith("```")) { raw = raw.split("```")[1] || ""; if (raw.startsWith("json")) raw = raw.slice(4); raw = raw.trim(); }
    let result;
    try { result = JSON.parse(raw); } catch { result = { answer: raw || "No result." }; }
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ answer: "Search request failed." });
  }
}
