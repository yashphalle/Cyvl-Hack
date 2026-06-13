import { useEffect, useState, useCallback, useRef } from "react";
import Map, { Source, Layer, NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import EvidenceCard from "./EvidenceCard";
import FilterPanel from "./FilterPanel";
import SearchBox from "./SearchBox";
import Tooltip from "./Tooltip";
import DataPage from "./DataPage";
import { scoreColor, scoreClass, scoreLabel } from "./utils";

const API = "http://localhost:8000";
const MAP_STYLES = {
  dark:  "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

const CATCHMENT_COLORS = ["#14a0c8","#8b5cf6","#f59e0b","#22c55e","#ec4899","#f97316","#06b6d4"];

const DEFAULT_FILTERS = {
  priorities: { high: true, medium: true, low: true },
  minScore: 0,
  minAge: 0,
};
const DEFAULT_LAYERS = { pipes: true, sewerNet: false, roads: false, catchments: false, stormInlets: false, heatmap: false, waterMains: false, waterRisk: false };

function scoreToClass(s) {
  if (s >= 50) return "high";
  if (s >= 35) return "medium";
  return "low";
}

const HIST_COLORS = ["#22c55e","#22c55e","#22c55e","#f59e0b","#f59e0b","#ef4444","#ef4444"];
const HIST_LABELS = ["0","10","20","30","40","50","60+"];

function ScoreHistogram({ dist }) {
  if (!dist.length) return null;
  const max = Math.max(...dist, 1);
  const BAR_W = 18, GAP = 3, H = 38;
  const W = dist.length * (BAR_W + GAP) - GAP;
  return (
    <div className="legend-hist">
      <div className="legend-hist-title">Score distribution</div>
      <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
        {dist.map((count, i) => {
          const h = Math.max(3, (count / max) * (H - 6));
          const x = i * (BAR_W + GAP);
          return (
            <g key={i}>
              <rect x={x} y={H - h} width={BAR_W} height={h}
                fill={HIST_COLORS[i]} opacity={0.75} rx={3} />
              <text x={x + BAR_W / 2} y={H + 11} textAnchor="middle"
                fontSize="8" fill="var(--text-3)">{HIST_LABELS[i]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function App() {
  const [geojson, setGeojson]         = useState(null);
  const [filteredGeo, setFilteredGeo] = useState(null);
  const [stats, setStats]             = useState(null);
  const [selected, setSelected]       = useState(null);
  const [tooltip, setTooltip]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [theme, setTheme]             = useState("dark");
  const [filters, setFilters]         = useState(DEFAULT_FILTERS);
  const [layers, setLayers]           = useState(DEFAULT_LAYERS);
  const [flyTarget, setFlyTarget]     = useState(null);
  const [page, setPage]               = useState("map"); // "map" | "data"
  const mapRef = useRef(null);
  const [catchmentGeo, setCatchmentGeo]   = useState(null);
  const [inletsGeo, setInletsGeo]         = useState(null);
  const [roadsGeo, setRoadsGeo]           = useState(null);
  const [waterMainsGeo, setWaterMainsGeo] = useState(null);
  const [waterRiskGeo, setWaterRiskGeo]   = useState(null);
  const [scoreDist, setScoreDist]     = useState([]);

  // sync theme
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  // load main data
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/segments`).then(r => r.json()),
      fetch(`${API}/api/stats`).then(r => r.json()),
    ]).then(([fc, s]) => {
      const features = fc.features.map(f => {
        const [r, g, b] = scoreColor(f.properties.score);
        return { ...f, properties: { ...f.properties, _r: r, _g: g, _b: b } };
      });
      const geo = { ...fc, features };
      setGeojson(geo);
      setFilteredGeo(geo);
      setStats(s);
      setLoading(false);
      const bins = Array(7).fill(0);
      features.forEach(f => {
        const bucket = Math.min(Math.floor(f.properties.score / 10), 6);
        bins[bucket]++;
      });
      setScoreDist(bins);
    });
  }, []);

  // load layer data lazily
  useEffect(() => {
    if (layers.roads && !roadsGeo) {
      fetch("/roads.geojson").then(r => r.json()).then(setRoadsGeo);
    }
    if (layers.catchments && !catchmentGeo) {
      fetch("/catchments.geojson").then(r => r.json()).then(fc => {
        const features = fc.features.map((f, i) => ({
          ...f, properties: { ...f.properties, _color: CATCHMENT_COLORS[i % CATCHMENT_COLORS.length] }
        }));
        setCatchmentGeo({ ...fc, features });
      });
    }
    if (layers.stormInlets && !inletsGeo) {
      fetch("/storm_inlets.geojson").then(r => r.json()).then(setInletsGeo);
    }
    if (layers.waterMains && !waterMainsGeo) {
      fetch("/water_mains.geojson").then(r => r.json()).then(setWaterMainsGeo);
    }
    if (layers.waterRisk && !waterRiskGeo) {
      fetch("/water_pipe_risk.geojson").then(r => r.json()).then(setWaterRiskGeo);
    }
  }, [layers, catchmentGeo, inletsGeo, roadsGeo, waterMainsGeo, waterRiskGeo]);

  // fly map when search returns a flyTo
  useEffect(() => {
    if (!flyTarget || !mapRef.current) return;
    mapRef.current.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: flyTarget.zoom ?? 15, duration: 1200 });
    setFlyTarget(null);
  }, [flyTarget]);

  // animated glow pulse on pipe layer
  useEffect(() => {
    if (!layers.pipes) return;
    let t = 0;
    const id = setInterval(() => {
      t += 0.045;
      const dark = theme === "dark";
      const base = dark ? 0.04 : 0.025;
      const amp  = dark ? 0.08 : 0.05;
      const opacity = base + amp * (0.5 + 0.5 * Math.sin(t));
      try { mapRef.current?.setPaintProperty("pipes-glow", "line-opacity", opacity); } catch {}
    }, 60);
    return () => clearInterval(id);
  }, [theme, layers.pipes]);

  // apply filters whenever filters or base geojson changes
  useEffect(() => {
    if (!geojson) return;
    const { priorities, minScore, minAge, maxAge = 999, minPci = 0, maxPci = 100, street = "" } = filters;
    const streetLower = street.toLowerCase();
    const features = geojson.features.filter(f => {
      const p = f.properties;
      if (!priorities[scoreToClass(p.score)]) return false;
      if (p.score < minScore) return false;
      if (minAge > 0 && (!p.pipe_age || p.pipe_age < minAge)) return false;
      if (maxAge < 999 && p.pipe_age && p.pipe_age > maxAge) return false;
      if (p.pci < minPci || p.pci > maxPci) return false;
      if (streetLower && !(p.street_name ?? "").toLowerCase().includes(streetLower)) return false;
      return true;
    });
    setFilteredGeo({ ...geojson, features });
  }, [filters, geojson]);

  const onSearchResult = useCallback((result) => {
    if (!result) { setFilters(DEFAULT_FILTERS); return; }
    if (result.filters) {
      setFilters(prev => ({
        priorities: { ...prev.priorities, ...result.filters.priorities },
        minScore:   result.filters.minScore  ?? prev.minScore,
        minAge:     result.filters.minAge    ?? prev.minAge,
        maxAge:     result.filters.maxAge    ?? 999,
        minPci:     result.filters.minPci    ?? 0,
        maxPci:     result.filters.maxPci    ?? 100,
        street:     result.filters.street    ?? "",
      }));
    }
    if (result.flyTo) {
      // store flyTo target — map will pick it up
      setFlyTarget(result.flyTo);
    }
    if (result.highlightId) {
      const feat = geojson?.features.find(f => f.properties.id === result.highlightId);
      if (feat) setSelected(feat);
    }
  }, [geojson]);

  const onMapClick = useCallback(e => {
    setSelected(e.features?.[0] ?? null);
  }, []);

  const onMouseMove = useCallback(e => {
    const feat = e.features?.[0];
    setTooltip(feat ? { x: e.point.x, y: e.point.y, props: feat.properties } : null);
  }, []);

  const isDark = theme === "dark";
  const visibleCount = filteredGeo?.features.length ?? 0;

  return (
    <>
      {/* ── topbar ── */}
      <div className="topbar">
        <div className="topbar-brand">
          <div className="logo">Bed<span>Rocked</span></div>
          <div className="sub">Somerville, MA</div>
        </div>
        <div className="cyvl-source">
          <span className="cyvl-dot">◉</span> Data from <b>Cyvl</b> street scan
          <Tooltip text={<><strong>Live Cyvl data</strong>Pavement 5,080 · catch basins 381 · above-ground assets 8,254 · signs 3,782 · street-level imagery — pulled from Cyvl project f15b854a. Sewer network from Somerville GIS. Click any segment to see the live Cyvl scan photo.</>} />
        </div>

        {stats && (
          <div className="topbar-stats">
            <div className="stat-metric">
              <div className="stat-num red">{stats.high_priority}</div>
              <div className="stat-lbl">Critical <Tooltip text="Segments with criticality score ≥50. Old pipes under failing pavement with high bundling potential — act now." /></div>
            </div>
            <div className="stat-sep" />
            <div className="stat-metric">
              <div className="stat-num amber">{stats.medium_priority.toLocaleString()}</div>
              <div className="stat-lbl">Moderate <Tooltip text="Segments scoring 35–50. Good candidates once critical segments are underway." /></div>
            </div>
            <div className="stat-sep" />
            <div className="stat-metric">
              <div className="stat-num green">{stats.low_priority}</div>
              <div className="stat-lbl">Low <Tooltip text="Segments scoring <35. Newer infrastructure or shallower pavement impact." /></div>
            </div>
            <div className="stat-sep" />
            <div className="stat-metric">
              <div className="stat-num blue">{stats.total_segments.toLocaleString()}</div>
              <div className="stat-lbl">Segments <Tooltip text="Total segments scored for construction criticality across road, sewer, and water infrastructure." /></div>
            </div>
            <div className="stat-distrib">
              <div className="stat-distrib-seg" style={{ flex: stats.high_priority,   background: "var(--red)" }} />
              <div className="stat-distrib-seg" style={{ flex: stats.medium_priority, background: "var(--amber)" }} />
              <div className="stat-distrib-seg" style={{ flex: stats.low_priority,    background: "var(--green)" }} />
            </div>
          </div>
        )}

        <nav className="topbar-nav">
          <button className={`nav-tab ${page === "map"  ? "active" : ""}`} onClick={() => setPage("map")}>Map</button>
          <button className={`nav-tab ${page === "data" ? "active" : ""}`} onClick={() => setPage("data")}>Data</button>
        </nav>

        <button className="theme-toggle" onClick={() => setTheme(isDark ? "light" : "dark")}>
          {isDark ? "☀ Light" : "☾ Dark"}
        </button>
      </div>

      {/* ── data page ── */}
      {page === "data" && <DataPage />}

      {/* ── map view ── */}
      {page === "map" && <>

      {/* ── loading ── */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">Loading Somerville sewer network…</div>
        </div>
      )}

      {/* ── map ── */}
      <div className="map-wrap">
        <Map
          initialViewState={{ longitude: -71.096, latitude: 42.3875, zoom: 13.5 }}
          ref={mapRef}
          style={{ width: "100%", height: "100%" }}
          mapStyle={MAP_STYLES[theme]}
          interactiveLayerIds={["pipes", "catchment-fill"]}
          onClick={onMapClick}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setTooltip(null)}
          cursor={tooltip ? "pointer" : "grab"}
        >
          <NavigationControl position="top-left" style={{ top: 8 }} />


          {/* raw sewer network (viz only) */}
          {layers.sewerNet && geojson && (
            <Source id="sewer-net" type="geojson" data={geojson}>
              <Layer id="sewer-net-layer" type="line" paint={{
                "line-color": "#92400e",
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 2, 16, 3],
                "line-opacity": 0.55,
              }} />
            </Source>
          )}

          {/* road PCI layer */}
          {layers.roads && roadsGeo && (
            <Source id="roads" type="geojson" data={roadsGeo}>
              <Layer id="roads-layer" type="line" paint={{
                "line-color": [
                  "step", ["get", "pci_score"],
                  "#ef4444",  40,
                  "#f59e0b",  70,
                  "#22c55e"
                ],
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 5],
                "line-opacity": 0.6,
              }} />
            </Source>
          )}

          {/* water mains (raw, blue) */}
          {layers.waterMains && waterMainsGeo && (
            <Source id="water-mains" type="geojson" data={waterMainsGeo}>
              <Layer id="water-mains-layer" type="line" paint={{
                "line-color": "#3b82f6",
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 3],
                "line-opacity": 0.7,
              }} />
            </Source>
          )}

          {/* water main risk */}
          {layers.waterRisk && waterRiskGeo && (
            <Source id="water-risk" type="geojson" data={waterRiskGeo}>
              <Layer id="water-risk-layer" type="line" paint={{
                "line-color": [
                  "match", ["get", "RiskQuad"],
                  "Failing",                  "#ef4444",
                  "High Risk",                "#f97316",
                  "Maintenance & Monitoring", "#f59e0b",
                  "#22c55e",
                ],
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 4],
                "line-opacity": 0.8,
              }} />
            </Source>
          )}

          {/* catchment zones */}
          {layers.catchments && catchmentGeo && (
            <Source id="catchments" type="geojson" data={catchmentGeo}>
              <Layer id="catchment-fill" type="fill" paint={{
                "fill-color": ["get", "_color"],
                "fill-opacity": 0.07,
              }} />
              <Layer id="catchment-line" type="line" paint={{
                "line-color": ["get", "_color"],
                "line-width": 1.5,
                "line-opacity": 0.5,
                "line-dasharray": [4, 3],
              }} />
              <Layer id="catchment-label" type="symbol" layout={{
                "text-field": ["get", "SumTribIn"],
                "text-size": 13,
                "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              }} paint={{
                "text-color": ["get", "_color"],
                "text-halo-color": isDark ? "#080d18" : "#fff",
                "text-halo-width": 2,
              }} />
            </Source>
          )}

          {/* storm inlets */}
          {layers.stormInlets && inletsGeo && (
            <Source id="inlets" type="geojson" data={inletsGeo}>
              <Layer id="inlets-layer" type="circle" paint={{
                "circle-color": "#14a0c8",
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 5],
                "circle-opacity": 0.7,
                "circle-stroke-color": isDark ? "#080d18" : "#fff",
                "circle-stroke-width": 1,
              }} />
            </Source>
          )}

          {/* urgency heatmap */}
          {layers.heatmap && filteredGeo && (
            <Source id="sewer-heat" type="geojson" data={filteredGeo}>
              <Layer id="pipe-heatmap" type="heatmap" paint={{
                "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 0, 0, 100, 1],
                "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 13, 0.5, 16, 1.2],
                "heatmap-color": [
                  "interpolate", ["linear"], ["heatmap-density"],
                  0,    "rgba(0,0,0,0)",
                  0.3,  "rgba(34,197,94,0.7)",
                  0.6,  "rgba(245,158,11,0.85)",
                  0.85, "rgba(239,68,68,0.95)",
                  1.0,  "rgba(255,60,10,1)",
                ],
                "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 13, 10, 15, 16, 17, 24],
                "heatmap-opacity": 0.85,
              }} />
            </Source>
          )}

          {/* sewer pipes */}
          {layers.pipes && filteredGeo && (
            <Source id="sewers" type="geojson" data={filteredGeo}>
              <Layer id="pipes-glow" type="line" paint={{
                "line-color": ["rgb", ["get", "_r"], ["get", "_g"], ["get", "_b"]],
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 20],
                "line-opacity": isDark ? 0.07 : 0.04,
                "line-blur": 8,
              }} />
              <Layer id="pipes" type="line" paint={{
                "line-color": ["rgb", ["get", "_r"], ["get", "_g"], ["get", "_b"]],
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 14, 3, 16, 5],
                "line-opacity": isDark ? 0.85 : 0.95,
              }} />
              {selected && (
                <Layer id="pipes-selected" type="line"
                  filter={["==", ["get", "id"], selected.properties.id]}
                  paint={{
                    "line-color": isDark ? "#fff" : "#0f1824",
                    "line-width": 5, "line-opacity": 1, "line-gap-width": 1,
                  }}
                />
              )}
            </Source>
          )}
        </Map>
      </div>

      {/* ── search box ── */}
      <SearchBox onResult={onSearchResult} visibleCount={visibleCount} />

      {/* ── filter panel ── */}
      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        layers={layers}
        onLayersChange={setLayers}
      />

      {/* ── legend ── */}
      <div className="legend">
        <div className="legend-title">
          Construction Criticality
          {visibleCount !== stats?.total_segments && (
            <span className="legend-count"> · {visibleCount.toLocaleString()} shown</span>
          )}
        </div>
        <div className="legend-gradient" />
        <div className="legend-labels">
          <span>Low</span><span>Medium</span><span>High</span>
        </div>
        <ScoreHistogram dist={scoreDist} />
      </div>

      {/* ── export ── */}
      <div className="export-bar">
        <a className="btn btn-ghost" href={`${API}/api/export/csv`} download>↓ CSV</a>
        <a className="btn btn-solid" href={`${API}/api/export/geojson`} download>↓ GeoJSON</a>
      </div>

      {/* ── evidence card ── */}
      <EvidenceCard feature={selected} onClose={() => setSelected(null)} />

      {/* ── tooltip ── */}
      {tooltip && (
        <div className="map-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y - 60 }}>
          <div className="tt-score" style={{ color: `rgb(${scoreColor(tooltip.props.score).join(",")})` }}>
            {tooltip.props.score}
          </div>
          <div className="tt-label" style={{ color: `rgb(${scoreColor(tooltip.props.score).join(",")})` }}>
            {scoreLabel(tooltip.props.score)}
          </div>
          {tooltip.props.street_name && <div className="tt-street">{tooltip.props.street_name}</div>}
        </div>
      )}

      </>}
    </>
  );
}
