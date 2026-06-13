import { scoreClass, scoreLabel } from "./utils";
import Tooltip from "./Tooltip";

const FACTOR_COLORS = {
  f1: "#38bdf8",
  f2: "#38bdf8",
  f3: "#38bdf8",
  f4: "#38bdf8",
  f5: "#38bdf8",
  f6: "#38bdf8",
};

const FACTOR_INFO = {
  f1: { title: "Pavement urgency (28%)", body: "Average PCI score of road segments within 50m. Low PCI = failing pavement = high urgency to dig now and repave in the same trench." },
  f2: { title: "Pipe age (22%)",         body: "Age of the pipe from install date. Older pipes are more likely to fail and are higher priority for separation. Max scale = 150 years." },
  f3: { title: "Dig cost (18%)",         body: "Estimated excavation depth from invert elevations. Shallower pipes cost less to dig, making separation more economical." },
  f4: { title: "Bundling value (12%)",   body: "Count of ADA ramps, catch basins, manholes, and sidewalks within 50m. More assets = more value from one open trench." },
  f5: { title: "Network leverage (8%)",  body: "Whether this pipe's upstream or downstream manhole connects to an already-separated pipe. Completing connected runs finishes catchments faster." },
  f6: { title: "Water co-risk (12%)",    body: "Risk rating of the nearest water main from Somerville's water pipe risk model. A failing water main alongside a combined sewer is a prime dig-once opportunity — the city will need to excavate anyway." },
};

const META_INFO = {
  "Installed":     "Year the pipe was originally installed, from Somerville's sewer GIS.",
  "Age":           "How old the pipe is in 2026. Pipes over 100 years are well past their design life.",
  "PCI Score":     "Pavement Condition Index (0–100) from Cyvl's street scan. Below 40 = poor, above 70 = good.",
  "Diameter":      "Internal pipe diameter in inches. Larger pipes handle more flow but cost more to replace.",
  "Material":      "Pipe construction material. Older clay and brick pipes are more prone to infiltration and collapse.",
  "Assets nearby":  "Number of bundlable infrastructure assets (ADA ramps, catch basins, sidewalks) within 50m of this pipe.",
  "Catch basins":   "Storm inlets within 50m that drain into this combined sewer. Each needs to be physically re-piped during separation. 3+ adds the full +5 pt bonus.",
  "Water risk":     "Risk quadrant of the nearest water main per Somerville DPW's pipe risk model. Failing = high likelihood AND high consequence of failure.",
};

const SCORE_INFO = "Construction criticality score 0–100. Higher = more critical to address now. Aggregated from road condition (PCI), pipe age, dig cost, asset bundling, network position, and water main co-risk.";

const WATER_RISK_COLOR = {
  "Failing":                  "#ef4444",
  "High Risk":                "#f97316",
  "Maintenance & Monitoring": "#f59e0b",
  "Low Risk":                 "#22c55e",
  "None":                     "#6b7280",
};

function FactorRow({ label, weight, value, colorKey }) {
  const info = FACTOR_INFO[colorKey];
  return (
    <div className="factor-row">
      <span className="factor-label">
        {label}
        <Tooltip text={<><strong>{info.title}</strong>{info.body}</>} />
      </span>
      <span className="factor-weight">{weight}</span>
      <div className="factor-track">
        <div className="factor-fill" style={{ width: `${value}%`, background: FACTOR_COLORS[colorKey] }} />
      </div>
      <span className="factor-val">{value.toFixed(0)}</span>
    </div>
  );
}

function MetaItem({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="meta-item">
      <div className="m-label">
        {label}
        {META_INFO[label] && <Tooltip text={META_INFO[label]} />}
      </div>
      <div className="m-val">{value}</div>
    </div>
  );
}

export default function EvidenceCard({ feature, onClose }) {
  if (!feature) return null;
  const p = feature.properties;
  const sc = scoreClass(p.score);
  // verifiable Cyvl imagery provenance, parsed from the live CDN url
  const cyvlHost = p.image_url ? p.image_url.replace(/^https?:\/\//, "").split("/")[0] : null;
  const cyvlAsset = p.image_url
    ? decodeURIComponent((p.image_url.split("/").slice(-2, -1)[0] || "").replace(/_/g, " "))
    : null;

  return (
    <div className="evidence-card">
      <div className="card-img-wrap">
        <div className={`card-accent ${sc}`} />
        {p.image_url ? (
          <>
            <img className="card-img" src={p.image_url} alt="Cyvl street-level scan" />
            <a className="cyvl-scan-badge" href={p.image_url} target="_blank" rel="noopener noreferrer"
               title="Opens the exact image live on Cyvl's CDN — proof this is Cyvl's scan, not stock.">
              ◉ LIVE CYVL SCAN ↗
            </a>
          </>
        ) : (
          <div className="card-img-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
            <span>No imagery</span>
          </div>
        )}
        <button className="card-close" onClick={onClose}>✕</button>
      </div>

      <div className="card-body">
        <div className="card-header">
          <div className="card-street">{p.street_name || "Unnamed Segment"}</div>
          <div className="card-pipe-id">{p.id}</div>
        </div>

        {p.image_url && (
          <a className="cyvl-source-line" href={p.image_url} target="_blank" rel="noopener noreferrer">
            <span className="cs-dot">◉</span>
            <span>Source: <b>Cyvl scan</b>{cyvlAsset ? ` · ${cyvlAsset}` : ""}</span>
            <span className="cs-host">{cyvlHost} ↗</span>
          </a>
        )}

        <div className="card-score-block">
          <div className="score-left">
            <span className={`score-num ${sc}`}>{p.score}</span>
            <span className="score-denom">/100</span>
            <Tooltip text={SCORE_INFO} />
          </div>
          <span className={`score-badge ${sc}`}>{scoreLabel(p.score)}</span>
        </div>

        <div className="card-section-title">Criticality Breakdown</div>
        <div className="factors-list">
          <FactorRow label="Pavement urgency" weight="28%" value={p.f1_pavement} colorKey="f1" />
          <FactorRow label="Pipe age"         weight="22%" value={p.f2_age}      colorKey="f2" />
          <FactorRow label="Dig cost"         weight="18%" value={p.f3_depth}    colorKey="f3" />
          <FactorRow label="Bundling value"   weight="12%" value={p.f4_bundling}   colorKey="f4" />
          <FactorRow label="Network leverage" weight="8%"  value={p.f5_network}   colorKey="f5" />
          <FactorRow label="Water co-risk"    weight="12%" value={p.f6_water_risk ?? 0} colorKey="f6" />
        </div>

        <div className="card-section-title">Pipe Details</div>
        <div className="card-meta-grid">
          <MetaItem label="Installed"      value={p.install_year} />
          <MetaItem label="Age"            value={p.pipe_age ? `${p.pipe_age} yrs` : "Unknown"} />
          <MetaItem label="PCI Score"      value={p.pci} />
          <MetaItem label="Diameter"       value={p.diameter_in > 0 ? `${p.diameter_in}"` : "—"} />
          <MetaItem label="Material"       value={p.material || "—"} />
          <MetaItem label="Assets nearby"  value={p.asset_count} />
          <MetaItem label="Catch basins"   value={p.catch_basin_count > 0 ? `${p.catch_basin_count} (+${p.catch_basin_bonus} pts)` : "0"} />
          {p.water_risk_quad && p.water_risk_quad !== "None" && (
            <div className="meta-item">
              <div className="m-label">
                Water risk
                <Tooltip text={META_INFO["Water risk"]} />
              </div>
              <div className="m-val" style={{ color: WATER_RISK_COLOR[p.water_risk_quad] ?? "#fff", fontWeight: 600 }}>
                {p.water_risk_quad}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
