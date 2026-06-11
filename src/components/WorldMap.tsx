// SVG world map renderer with pan/zoom and click selection. Self-contained: it
// renders the precomputed shapes from ../map/world and reports country clicks to
// the game store. No external tiles or APIs.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { shapes, MAP_WIDTH, MAP_HEIGHT } from "../map/world";
import { countryName } from "../i18n";
import { sameFlag } from "../game/flagTwins";
import { useGame } from "../store/gameStore";
import { useSettings } from "../store/settingsStore";
import { t } from "../i18n";

interface Transform {
  k: number;
  x: number;
  y: number;
}

const MIN_K = 1;
const MAX_K = 14;
const LABEL_PX = 11; // on-screen label height in viewBox units

// Label candidates, largest country first. Greedy declutter keeps the biggest
// countries' labels and drops any that would overlap one already placed, so more
// labels reveal themselves as you zoom in (overlaps clear up at higher zoom).
const labelCandidates = shapes
  .filter((s) => s.guessable)
  .sort((a, b) => b.area - a.area);

export function WorldMap({ overlay }: { overlay?: ReactNode }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tf, setTf] = useState<Transform>({ k: 1, x: 0, y: 0 });

  const status = useGame((s) => s.status);
  const targetId = useGame((s) => s.targetId);
  const selectedId = useGame((s) => s.selectedId);
  const wrongPicks = useGame((s) => s.wrongPicks);
  const select = useGame((s) => s.select);

  const showLabels = useSettings((s) => s.showLabels);
  const language = useSettings((s) => s.language);
  const mapSize = useSettings((s) => s.mapSize);

  // --- pan + click ---
  // We capture the country under the cursor at pointer-DOWN time (before
  // setPointerCapture redirects events to the <svg>), then commit the selection
  // on pointer-up if it wasn't a drag. Using the native `click` event does not
  // work here: pointer capture makes the browser fire `click` on the captured
  // <svg>, never on the individual <path>.
  const drag = useRef<{
    active: boolean;
    // ox/oy: fixed press origin, used to measure total displacement.
    // lx/ly: last move position, used to compute the incremental pan delta.
    ox: number;
    oy: number;
    lx: number;
    ly: number;
    moved: boolean;
    downId: string;
    guessable: boolean;
  }>({
    active: false,
    ox: 0,
    oy: 0,
    lx: 0,
    ly: 0,
    moved: false,
    downId: "",
    guessable: false,
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = e.target as Element;
    drag.current = {
      active: true,
      ox: e.clientX,
      oy: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      moved: false,
      downId: el.getAttribute("data-id") ?? "",
      guessable: el.getAttribute("data-guessable") === "1",
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.lx;
    const dy = e.clientY - drag.current.ly;
    // Measure displacement from the press origin, not from the previous move,
    // so a slow drag (many sub-threshold steps) still counts as a pan rather
    // than collapsing into a click on the country under the press point.
    if (
      Math.abs(e.clientX - drag.current.ox) +
        Math.abs(e.clientY - drag.current.oy) >
      3
    )
      drag.current.moved = true;
    drag.current.lx = e.clientX;
    drag.current.ly = e.clientY;
    setTf((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  };
  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    // Only react to the end of a real press. Without this guard a bare
    // pointerleave (cursor exiting the frame with no button down) would re-run
    // the selection below using the stale ref from the previous click.
    if (!d.active) return;
    d.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // A tap/click (no drag) on a guessable country selects it.
    if (!d.moved && d.downId && d.guessable && status === "guessing") {
      select(d.downId);
    }
  };

  // --- zoom toward cursor (native non-passive wheel listener) ---
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const vx = ((clientX - rect.left) / rect.width) * MAP_WIDTH;
      const vy = ((clientY - rect.top) / rect.height) * MAP_HEIGHT;
      setTf((p) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, p.k * factor));
        const ratio = k / p.k;
        return { k, x: vx - (vx - p.x) * ratio, y: vy - (vy - p.y) * ratio };
      });
    },
    [],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const zoomButton = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const reset = () => setTf({ k: 1, x: 0, y: 0 });

  const fillFor = useMemo(
    () =>
      (id: string): string => {
        const revealed = status === "revealed";
        if (revealed && id && id === targetId) return "#3fb27f"; // correct answer
        if (revealed && id && id === selectedId)
          // green if the pick's flag matches the target (twin flags), else red
          return targetId && sameFlag(id, targetId) ? "#3fb27f" : "#e25563";
        // A spent wrong guess (challenge multi-attempt) stays red while guessing.
        if (id && wrongPicks.includes(id)) return "#e25563";
        if (id && id === selectedId) return "#4f86c6"; // current selection
        return "#b9c5d0"; // land
      },
    [status, targetId, selectedId, wrongPicks],
  );

  // Decide which labels to draw for the current view: project each centroid to
  // viewBox space, skip off-screen ones, then greedily reject overlaps.
  const visibleLabels = useMemo(() => {
    if (!showLabels) return [];
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: { id: string; cx: number; cy: number; name: string }[] = [];
    for (const s of labelCandidates) {
      const sx = tf.x + s.cx * tf.k;
      const sy = tf.y + s.cy * tf.k;
      if (sx < 0 || sx > MAP_WIDTH || sy < 0 || sy > MAP_HEIGHT) continue;
      const name = countryName(s.id, language, s.rawName);
      const halfW = name.length * LABEL_PX * 0.27 + 2;
      const halfH = LABEL_PX * 0.62;
      const box = {
        x0: sx - halfW,
        y0: sy - halfH,
        x1: sx + halfW,
        y1: sy + halfH,
      };
      const clash = placed.some(
        (p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0,
      );
      if (clash) continue;
      placed.push(box);
      out.push({ id: s.id, cx: s.cx, cy: s.cy, name });
    }
    return out;
  }, [showLabels, language, tf]);

  const labelSize = LABEL_PX / tf.k;

  return (
    <div className="map-wrap" style={{ width: `${mapSize}%` }}>
      {overlay}
      <svg
        ref={svgRef}
        className="world-map"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerLeave={endPointer}
        onPointerCancel={endPointer}
      >
        <rect
          x={0}
          y={0}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          fill="#a9d6e5"
        />
        <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.k})`}>
          {shapes.map((s, i) => (
            <path
              key={s.id || `x${i}`}
              d={s.d}
              data-id={s.id}
              data-guessable={s.guessable ? "1" : "0"}
              fill={fillFor(s.id)}
              stroke="#ffffff"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
              className={[
                "country",
                s.guessable && status === "guessing" ? "guessable" : "",
                s.id && s.id === selectedId ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <title>{countryName(s.id, language, s.rawName)}</title>
            </path>
          ))}
          {visibleLabels.map((l) => (
            <text
              key={`l${l.id}`}
              x={l.cx}
              y={l.cy}
              fontSize={labelSize}
              strokeWidth={labelSize * 0.08}
              className="country-label"
            >
              {l.name}
            </text>
          ))}
        </g>
      </svg>

      <div className="map-controls">
        <button
          onClick={() => zoomButton(1.4)}
          title={t("zoomIn", language)}
          aria-label={t("zoomIn", language)}
        >
          +
        </button>
        <button
          onClick={() => zoomButton(1 / 1.4)}
          title={t("zoomOut", language)}
          aria-label={t("zoomOut", language)}
        >
          −
        </button>
        <button
          onClick={reset}
          title={t("resetView", language)}
          aria-label={t("resetView", language)}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
