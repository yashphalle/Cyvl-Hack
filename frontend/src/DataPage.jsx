import { useState, useRef } from "react";

const DATA_SOURCES = [
  {
    key: "sewer",
    label: "Sewer Network",
    desc: "Combined & sanitary pipe segments with manhole IDs",
    icon: "⬡",
    accepts: ".geojson, .shp, .csv",
    required: true,
    fields: ["Pipe ID", "Install Year", "Material", "Diameter", "From MH", "To MH"],
  },
  {
    key: "pavement",
    label: "Pavement Condition",
    desc: "Road segment PCI scores from pavement scan or manual survey",
    icon: "━",
    accepts: ".geojson, .csv",
    required: true,
    fields: ["Segment ID", "Street Name", "PCI Score"],
  },
  {
    key: "assets",
    label: "Asset Inventory",
    desc: "ADA ramps, catch basins, manholes, sidewalks for bundling analysis",
    icon: "◉",
    accepts: ".geojson, .csv",
    required: false,
    fields: ["Asset Type", "Lat", "Lng"],
  },
  {
    key: "water",
    label: "Water Mains",
    desc: "Water distribution pipes for co-dig opportunity detection",
    icon: "〜",
    accepts: ".geojson, .shp",
    required: false,
    fields: ["Pipe ID", "Install Year", "Material", "Risk Rating"],
  },
];

const DEFAULT_WEIGHTS = { f1: 30, f2: 25, f3: 20, f4: 15, f5: 10 };
const FACTORS = [
  { key: "f1", label: "Pavement urgency",  color: "#14a0c8", desc: "Weight given to road PCI score" },
  { key: "f2", label: "Pipe age",          color: "#8b5cf6", desc: "Weight given to pipe installation age" },
  { key: "f3", label: "Dig cost",          color: "#f59e0b", desc: "Weight given to excavation depth (shallower = cheaper)" },
  { key: "f4", label: "Bundling value",    color: "#22c55e", desc: "Weight given to nearby co-diggable assets" },
  { key: "f5", label: "Network leverage",  color: "#ec4899", desc: "Weight given to connection with already-separated pipes" },
];

function DropZone({ source, uploaded, onUpload }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(source.key, file.name);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (file) onUpload(source.key, file.name);
  };

  return (
    <div
      className={`drop-zone ${dragging ? "drag-over" : ""} ${uploaded ? "uploaded" : ""}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !uploaded && inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept={source.accepts} style={{ display: "none" }} onChange={handleFile} />

      <div className="dz-header">
        <span className="dz-icon">{source.icon}</span>
        <div>
          <div className="dz-title">
            {source.label}
            {source.required && <span className="dz-required">required</span>}
          </div>
          <div className="dz-desc">{source.desc}</div>
        </div>
        {uploaded && (
          <span className="dz-check">✓</span>
        )}
      </div>

      {uploaded ? (
        <div className="dz-file">
          <span className="dz-file-icon">📄</span>
          <span className="dz-file-name">{uploaded}</span>
          <button className="dz-remove" onClick={e => { e.stopPropagation(); onUpload(source.key, null); }}>✕</button>
        </div>
      ) : (
        <div className="dz-prompt">
          <span>Drop file or <u>browse</u></span>
          <span className="dz-accepts">{source.accepts}</span>
        </div>
      )}

      <div className="dz-fields">
        {source.fields.map(f => <span key={f} className="dz-field-tag">{f}</span>)}
      </div>
    </div>
  );
}

export default function DataPage() {
  const [uploads, setUploads]   = useState({});
  const [weights, setWeights]   = useState(DEFAULT_WEIGHTS);
  const [arcgisUrl, setArcgisUrl] = useState("");
  const [tab, setTab]           = useState("upload"); // "upload" | "arcgis"
  const [ran, setRan]           = useState(false);

  const setUpload = (key, name) => setUploads(u => ({ ...u, [key]: name }));

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const setWeight = (key, val) => {
    setWeights(w => ({ ...w, [key]: Number(val) }));
  };

  const requiredUploaded = DATA_SOURCES.filter(s => s.required).every(s => uploads[s.key]);
  const canRun = (tab === "upload" && requiredUploaded) || (tab === "arcgis" && arcgisUrl.trim());

  return (
    <div className="data-page">
      <div className="dp-content">

        {/* left column — data sources */}
        <div className="dp-col">
          <div className="dp-section-title">Data Sources</div>
          <div className="dp-tab-row">
            <button className={`dp-tab ${tab === "upload" ? "active" : ""}`} onClick={() => setTab("upload")}>
              File Upload
            </button>
            <button className={`dp-tab ${tab === "arcgis" ? "active" : ""}`} onClick={() => setTab("arcgis")}>
              ArcGIS REST
            </button>
          </div>

          {tab === "upload" ? (
            <div className="dp-dropzones">
              {DATA_SOURCES.map(s => (
                <DropZone key={s.key} source={s} uploaded={uploads[s.key]} onUpload={setUpload} />
              ))}
            </div>
          ) : (
            <div className="dp-arcgis">
              <div className="dp-arcgis-label">
                ArcGIS MapServer URL
                <span className="dp-arcgis-hint">Works with any public ArcGIS REST endpoint</span>
              </div>
              <div className="dp-arcgis-row">
                <input
                  className="dp-arcgis-input"
                  placeholder="https://gis.yourcity.gov/arcgis/rest/services/Sewer/MapServer"
                  value={arcgisUrl}
                  onChange={e => setArcgisUrl(e.target.value)}
                />
                <button className="dp-arcgis-connect" disabled={!arcgisUrl.trim()}>
                  Connect
                </button>
              </div>

              <div className="dp-arcgis-example">
                <div className="dp-arcgis-ex-label">Example — Somerville, MA</div>
                <code className="dp-arcgis-code" onClick={() => setArcgisUrl("https://maps.somervillema.gov/arcgis/rest/services/SewerAndStormWaterSystem/MapServer")}>
                  https://maps.somervillema.gov/arcgis/rest/services/SewerAndStormWaterSystem/MapServer
                </code>
              </div>

              <div className="dp-arcgis-layers">
                <div className="dp-arcgis-layers-title">Auto-detected layers</div>
                {[
                  { id: 10, name: "Combined Sewer Mains", status: "ready" },
                  { id: 11, name: "Storm Mains",          status: "ready" },
                  { id: 13, name: "SS Manholes",          status: "ready" },
                  { id: 14, name: "Storm Inlets",         status: "ready" },
                  { id: 15, name: "Sewer Subsystems",     status: "ready" },
                ].map(l => (
                  <div key={l.id} className="dp-arcgis-layer-row">
                    <span className="dp-layer-dot" />
                    <span className="dp-layer-id">Layer {l.id}</span>
                    <span className="dp-layer-name">{l.name}</span>
                    <span className="dp-layer-status">{l.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* right column — scoring config */}
        <div className="dp-col dp-col-right">
          <div className="dp-section-title">Scoring Configuration</div>
          <div className="dp-scoring-desc">
            Adjust how much each factor contributes to the final 0–100 readiness score.
            Weights must add up to 100.
          </div>

          <div className="dp-weights">
            {FACTORS.map(f => (
              <div key={f.key} className="dp-weight-row">
                <div className="dp-weight-header">
                  <span className="dp-weight-dot" style={{ background: f.color }} />
                  <span className="dp-weight-label">{f.label}</span>
                  <span className="dp-weight-desc">{f.desc}</span>
                  <span className="dp-weight-val" style={{ color: f.color }}>{weights[f.key]}%</span>
                </div>
                <input
                  type="range" className="fp-slider dp-slider"
                  min={0} max={60} step={5}
                  value={weights[f.key]}
                  style={{ "--thumb-color": f.color }}
                  onChange={e => setWeight(f.key, e.target.value)}
                />
              </div>
            ))}

            <div className={`dp-weight-total ${totalWeight === 100 ? "ok" : "warn"}`}>
              Total: {totalWeight}% {totalWeight !== 100 && `— needs to equal 100`}
            </div>
          </div>

          <div className="dp-section-title" style={{ marginTop: 28 }}>Thresholds</div>
          <div className="dp-thresholds">
            {[
              { label: "High priority cutoff",   val: "≥ 50",  color: "var(--red)",   desc: "Segments at or above this score are flagged critical" },
              { label: "Medium priority cutoff",  val: "≥ 35",  color: "var(--amber)", desc: "Segments in this range are moderate priority" },
              { label: "Spatial buffer radius",   val: "50 m",  color: "var(--blue)",  desc: "Radius used to find nearby assets and pavement data" },
              { label: "Max pipe age reference",  val: "150 yr", color: "var(--text-2)", desc: "Age at which pipe age factor scores 100" },
            ].map(t => (
              <div key={t.label} className="dp-threshold-row">
                <span className="dp-thresh-label">{t.label}</span>
                <span className="dp-thresh-val" style={{ color: t.color }}>{t.val}</span>
                <span className="dp-thresh-desc">{t.desc}</span>
              </div>
            ))}
          </div>

          <button
            className={`dp-run-btn ${canRun ? "active" : ""} ${ran ? "done" : ""}`}
            disabled={!canRun}
            onClick={() => setRan(true)}
          >
            {ran ? "✓ Analysis complete — view map" : "Run Analysis →"}
          </button>
        </div>

      </div>
    </div>
  );
}
