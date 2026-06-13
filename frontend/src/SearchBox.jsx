import { useState, useRef } from "react";

const API = "http://localhost:8000";

const EXAMPLES = [
  "Show pipes older than 120 years",
  "Only high priority on Highland Ave",
  "Worst pavement, shallow dig",
  "Pipes installed before 1920",
];

export default function SearchBox({ onResult }) {
  const [query, setQuery]     = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer]   = useState(null);
  const [error, setError]     = useState(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  const submit = async (q) => {
    const text = (q ?? query).trim();
    if (!text) return;
    setQuery(text);
    setLoading(true);
    setAnswer(null);
    setError(null);

    try {
      const res = await fetch(`${API}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.answer) setAnswer(data.answer);
      onResult(data);
    } catch (e) {
      setError("Search failed — check your API key");
    } finally {
      setLoading(false);
      setFocused(false);
    }
  };

  const clear = () => {
    setQuery("");
    setAnswer(null);
    setError(null);
    onResult(null);
    inputRef.current?.focus();
  };

  return (
    <div className="search-wrap">
      <div className={`search-box ${focused ? "focused" : ""} ${loading ? "loading" : ""}`}>
        {/* icon */}
        <span className="search-icon">
          {loading
            ? <span className="search-spinner" />
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
          }
        </span>

        <input
          ref={inputRef}
          className="search-input"
          placeholder="Ask anything — pipes older than 100 yrs, worst PCI on Broadway…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={e => e.key === "Enter" && submit()}
          disabled={loading}
        />

        {query && (
          <button className="search-clear" onClick={clear}>✕</button>
        )}

        <button
          className="search-submit"
          onClick={() => submit()}
          disabled={loading || !query.trim()}
        >
          Ask
        </button>
      </div>

      {/* example chips — show when focused and empty */}
      {focused && !query && (
        <div className="search-suggestions">
          <div className="suggestion-label">Try asking</div>
          <div className="suggestion-chips">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                className="suggestion-chip"
                onMouseDown={() => submit(ex)}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* answer bubble */}
      {answer && (
        <div className="search-answer">
          <span className="answer-icon">◈</span>
          <span>{answer}</span>
          <button className="answer-clear" onClick={clear}>✕</button>
        </div>
      )}

      {/* error */}
      {error && (
        <div className="search-error">{error}</div>
      )}
    </div>
  );
}
