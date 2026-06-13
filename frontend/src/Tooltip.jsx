import { useState, useRef } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({ text }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef(null);

  const show = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ x: r.right + 8, y: r.top });
    }
    setVisible(true);
  };

  return (
    <>
      <span
        ref={ref}
        className="info-btn"
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
      >?</span>

      {visible && createPortal(
        <div
          className="info-popup"
          style={{ left: pos.x, top: pos.y }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
