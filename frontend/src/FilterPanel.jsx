const PRIORITIES = [
  { key: "high",   label: "High",   color: "var(--red)",   dim: "var(--red-dim)",   border: "rgba(239,68,68,0.25)" },
  { key: "medium", label: "Medium", color: "var(--amber)", dim: "var(--amber-dim)", border: "rgba(245,158,11,0.25)" },
  { key: "low",    label: "Low",    color: "var(--green)", dim: "var(--green-dim)", border: "rgba(34,197,94,0.25)" },
];

const LAYERS = [
  { key: "catchments",   label: "Catchment zones",  icon: "▣" },
  { key: "stormInlets",  label: "Storm inlets",      icon: "◉" },
];

export default function FilterPanel({ filters, onFiltersChange, layers, onLayersChange }) {
  const toggle = (key) =>
    onFiltersChange({ ...filters, priorities: { ...filters.priorities, [key]: !filters.priorities[key] } });

  const setScore = (val) =>
    onFiltersChange({ ...filters, minScore: Number(val) });

  const setAge = (val) =>
    onFiltersChange({ ...filters, minAge: Number(val) });

  const toggleLayer = (key) =>
    onLayersChange({ ...layers, [key]: !layers[key] });

  return (
    <div className="filter-panel">
      {/* priority toggles */}
      <div className="fp-section">
        <div className="fp-label">Priority</div>
        <div className="fp-pills">
          {PRIORITIES.map(p => {
            const active = filters.priorities[p.key];
            return (
              <button
                key={p.key}
                className="fp-pill"
                onClick={() => toggle(p.key)}
                style={{
                  background: active ? p.dim : "transparent",
                  color: active ? p.color : "var(--text-3)",
                  borderColor: active ? p.border : "var(--border)",
                }}
              >
                <span className="fp-dot" style={{ background: active ? p.color : "var(--text-3)" }} />
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* score range */}
      <div className="fp-section">
        <div className="fp-label-row">
          <span className="fp-label">Min score</span>
          <span className="fp-val">{filters.minScore}</span>
        </div>
        <input
          type="range" className="fp-slider"
          min={0} max={60} step={1}
          value={filters.minScore}
          onChange={e => setScore(e.target.value)}
        />
        <div className="fp-slider-labels"><span>0</span><span>60</span></div>
      </div>

      {/* pipe age */}
      <div className="fp-section">
        <div className="fp-label-row">
          <span className="fp-label">Min pipe age</span>
          <span className="fp-val">{filters.minAge > 0 ? `${filters.minAge} yrs` : "any"}</span>
        </div>
        <input
          type="range" className="fp-slider"
          min={0} max={160} step={10}
          value={filters.minAge}
          onChange={e => setAge(e.target.value)}
        />
        <div className="fp-slider-labels"><span>any</span><span>160 yrs</span></div>
      </div>

      {/* layer toggles */}
      <div className="fp-section fp-section-last">
        <div className="fp-label">Layers</div>
        {LAYERS.map(l => (
          <button
            key={l.key}
            className="fp-layer-row"
            onClick={() => toggleLayer(l.key)}
          >
            <span className="fp-layer-icon">{l.icon}</span>
            <span className="fp-layer-label">{l.label}</span>
            <span className={`fp-switch ${layers[l.key] ? "on" : ""}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
