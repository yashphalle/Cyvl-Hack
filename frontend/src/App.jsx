import { useEffect, useState, useCallback, useRef } from "react";
import Map, { Source, Layer, NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import EvidenceCard from "./EvidenceCard";
import FilterPanel from "./FilterPanel";
import SearchBox from "./SearchBox";
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
const DEFAULT_LAYERS = { catchments: false, stormInlets: false };

function scoreToClass(s) {
  if (s >= 50) return "high";
  if (s >= 35) return "medium";
  return "low";
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
  const mapRef = useRef(null);
  const [catchmentGeo, setCatchmentGeo] = useState(null);
  const [inletsGeo, setInletsGeo]     = useState(null);

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
    });
  }, []);

  // load layer data lazily
  useEffect(() => {
    if (layers.catchments && !catchmentGeo) {
      fetch("/catchments.geojson").then(r => r.json()).then(fc => {
        // add color index
        const features = fc.features.map((f, i) => ({
          ...f, properties: { ...f.properties, _color: CATCHMENT_COLORS[i % CATCHMENT_COLORS.length] }
        }));
        setCatchmentGeo({ ...fc, features });
      });
    }
    if (layers.stormInlets && !inletsGeo) {
      fetch("/storm_inlets.geojson").then(r => r.json()).then(setInletsGeo);
    }
  }, [layers, catchmentGeo, inletsGeo]);

  // fly map when search returns a flyTo
  useEffect(() => {
    if (!flyTarget || !mapRef.current) return;
    mapRef.current.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: flyTarget.zoom ?? 15, duration: 1200 });
    setFlyTarget(null);
  }, [flyTarget]);

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
          <div className="logo">Sewer<span>shed</span></div>
          <div className="sub">Somerville, MA</div>
        </div>

        {stats && (
          <div className="topbar-stats">
            <div className="stat-chip red">
              <div className="chip-val">{stats.high_priority}</div>
              <div className="chip-lbl">High<br/>Priority</div>
            </div>
            <div className="stat-chip amber">
              <div className="chip-val">{stats.medium_priority}</div>
              <div className="chip-lbl">Medium<br/>Priority</div>
            </div>
            <div className="stat-chip green">
              <div className="chip-val">{stats.low_priority}</div>
              <div className="chip-lbl">Low<br/>Priority</div>
            </div>
            <div className="stat-chip blue">
              <div className="chip-val">{stats.total_segments.toLocaleString()}</div>
              <div className="chip-lbl">Combined<br/>Pipes</div>
            </div>
          </div>
        )}

        <button className="theme-toggle" onClick={() => setTheme(isDark ? "light" : "dark")}>
          {isDark ? "☀ Light" : "☾ Dark"}
        </button>
      </div>

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

          {/* sewer pipes */}
          {filteredGeo && (
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
      <SearchBox onResult={onSearchResult} />

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
          Separation Readiness
          {visibleCount !== stats?.total_segments && (
            <span className="legend-count"> · {visibleCount.toLocaleString()} shown</span>
          )}
        </div>
        <div className="legend-gradient" />
        <div className="legend-labels">
          <span>Low</span><span>Medium</span><span>High</span>
        </div>
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
    </>
  );
}
