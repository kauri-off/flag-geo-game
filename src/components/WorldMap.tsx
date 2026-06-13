// SVG world map renderer with pan/zoom and click selection. Self-contained: it
// renders the precomputed shapes from ../map/world and reports country clicks to
// the game store. No external tiles or APIs.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { shapes, MAP_WIDTH, MAP_HEIGHT } from "../map/world";
import { countryName } from "../i18n";
import { sameFlag } from "../game/flagTwins";
import { useGame } from "../store/gameStore";
import { useSettings } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { t } from "../i18n";

interface Transform {
  k: number;
  x: number;
  y: number;
}

const MIN_K = 1;
const MAX_K = 120;
const LABEL_PX = 11; // on-screen label height in viewBox units

// Label candidates, largest country first. Greedy declutter keeps the biggest
// countries' labels and drops any that would overlap one already placed, so more
// labels reveal themselves as you zoom in (overlaps clear up at higher zoom).
const labelCandidates = shapes
  .filter((s) => s.guessable)
  .sort((a, b) => b.area - a.area);

// All guessable shapes, scanned on an ocean click to find the nearest country.
const guessableShapes = shapes.filter((s) => s.guessable);

// Shape lookup by numeric id, for the reveal fit-zoom.
const shapeById = new Map(shapes.filter((s) => s.id).map((s) => [s.id, s]));

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

// Module-level so the current pan/zoom survives the WorldMap unmounting and
// remounting (e.g. switching tabs and coming back) instead of snapping to 1:1.
let savedTf: Transform = { k: 1, x: 0, y: 0 };

// Wheel/button zooms use proportional (exponential) smoothing with NO speed cap:
// each frame the scale closes a fixed fraction of the remaining distance, so the
// velocity is proportional to how far the target is. Big/fast scrolls whip toward
// the target faster than the eye can track, small ones snap almost instantly, and
// the view stays glued to the target even when you scroll up-down in a loop — the
// Google-Maps feel. TAU_ZOOM is the time constant (smaller = tighter tracking);
// SNAP_K is the relative closeness at which we finish, so there's no visible crawl
// through the last sliver. Reveal/reset fly-tos use TAU_FLY (they also pan far).
const TAU_ZOOM = 0.04;
const SNAP_K = 4e-3;
const TAU_FLY = 0.16;

// --- Van Wijk & Nuij smooth zoom/pan (the Google-Maps "fly") ---
// A view is described as [centerX, centerY, viewWidth] in world units. The arc
// zooms out just enough to bridge the gap, pans, then zooms back in — instead of
// a straight interpolation that rushes the camera past everything. RHO tunes how
// much it backs out (√2 ≈ the d3 default: a balanced "not fully out" arc).
const RHO = Math.SQRT2;
type View = [number, number, number];
const viewOf = (t: Transform): View => [
  (MAP_WIDTH / 2 - t.x) / t.k,
  (MAP_HEIGHT / 2 - t.y) / t.k,
  MAP_WIDTH / t.k,
];
const transformOf = ([cx, cy, w]: View): Transform => {
  const k = MAP_WIDTH / w;
  return { k, x: MAP_WIDTH / 2 - cx * k, y: MAP_HEIGHT / 2 - cy * k };
};
// Returns the path function at(t) (t in [0,1]) and S, its total "perceived"
// length — used to pick a watchable duration.
function interpolateView(p0: View, p1: View) {
  const [ux0, uy0, w0] = p0;
  const [ux1, uy1, w1] = p1;
  const dx = ux1 - ux0;
  const dy = uy1 - uy0;
  const d2 = dx * dx + dy * dy;
  const rho2 = RHO * RHO; // 2
  const rho4 = rho2 * rho2; // 4
  let S: number;
  let at: (t: number) => View;
  if (d2 < 1e-12) {
    // Pure zoom, no pan: exponential interpolation of the view width.
    S = Math.log(w1 / w0) / RHO; // signed
    at = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * S)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / RHO;
    const cosh = (x: number) => (Math.exp(x) + Math.exp(-x)) / 2;
    const sinh = (x: number) => (Math.exp(x) - Math.exp(-x)) / 2;
    const tanh = (x: number) => {
      const e = Math.exp(2 * x);
      return (e - 1) / (e + 1);
    };
    const cr0 = cosh(r0);
    at = (t) => {
      const s = t * S * RHO;
      const u = (w0 / (rho2 * d1)) * (cr0 * tanh(s + r0) - sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, (w0 * cr0) / cosh(s + r0)];
    };
  }
  return { at, S };
}
// Slow, symmetric ease so the flight starts and ends gently (no whip at t=0).
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function WorldMap({ overlay }: { overlay?: ReactNode }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tf, setTf] = useState<Transform>(savedTf);
  // Live mirror of `tf` so event/effect callbacks read the latest transform
  // without re-subscribing on every pan frame. Also stash it at module scope so
  // it persists across unmount/remount (tab switches).
  const tfRef = useRef(tf);
  tfRef.current = tf;
  savedTf = tf;
  // The animator continuously eases the live `tf` toward `targetRef` on a single
  // rAF loop (animRef). Wheel/button/reveal all just nudge the target and kick
  // the loop; nothing sets the rendered transform abruptly. `tauRef` is the
  // current smoothing time constant; `lastTsRef` is the previous frame time for
  // framerate-independent stepping.
  const animRef = useRef<number | null>(null);
  const targetRef = useRef<Transform>(tf);
  const lastTsRef = useRef(0);
  // Active Van Wijk flight: its path function, total duration, and start time.
  const arcRef = useRef<{
    at: (t: number) => View;
    dur: number;
    t0: number;
  } | null>(null);
  // Which animator the loop is running, and (for zoom) the screen point + the
  // world point under it to keep pinned together as the scale changes.
  const modeRef = useRef<"zoom" | "fly" | "arc">("zoom");
  const focalRef = useRef({ vx: 0, vy: 0, wx: 0, wy: 0 });

  // True while a finger/mouse drag is panning the map. We freeze the label
  // declutter while it's set (see visibleLabels) so each pan frame skips the
  // expensive O(n²) overlap pass — the cause of drag input lag.
  const [dragging, setDragging] = useState(false);

  const status = useGame((s) => s.status);
  const targetId = useGame((s) => s.targetId);
  const selectedId = useGame((s) => s.selectedId);
  const wrongPicks = useGame((s) => s.wrongPicks);
  const select = useGame((s) => s.select);
  const mapZoomNonce = useUi((s) => s.mapZoomNonce);

  const showLabels = useSettings((s) => s.showLabels);
  const language = useSettings((s) => s.language);
  const oceanSnapRadius = useSettings((s) => s.oceanSnapRadius);

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
    // viewBox units per client pixel for this drag. The SVG scales its viewBox
    // to the element (preserveAspectRatio "meet"), so a 1px cursor move is not
    // 1 viewBox unit; we convert pan deltas through this so the point under the
    // cursor stays pinned.
    scale: number;
  }>({
    active: false,
    ox: 0,
    oy: 0,
    lx: 0,
    ly: 0,
    moved: false,
    downId: "",
    guessable: false,
    scale: 1,
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    cancelAnim();
    // Freeze the target where the view currently sits so the (now stopped)
    // animator has nothing to drift toward while the user drags.
    targetRef.current = tfRef.current;
    const el = e.target as Element;
    // With xMidYMid meet the viewBox is uniformly scaled to fit; the on-screen
    // size of one viewBox unit is min(rect.w/MAP_WIDTH, rect.h/MAP_HEIGHT).
    // Invert that to get viewBox units per client pixel for delta conversion.
    const rect = e.currentTarget.getBoundingClientRect();
    const fit = Math.min(rect.width / MAP_WIDTH, rect.height / MAP_HEIGHT);
    drag.current = {
      active: true,
      ox: e.clientX,
      oy: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      moved: false,
      downId: el.getAttribute("data-id") ?? "",
      guessable: el.getAttribute("data-guessable") === "1",
      scale: fit > 0 ? 1 / fit : 1,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current.active) return;
    // Client-pixel delta converted to viewBox units so the map tracks the cursor.
    const dx = (e.clientX - drag.current.lx) * drag.current.scale;
    const dy = (e.clientY - drag.current.ly) * drag.current.scale;
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
    setTf((p) => {
      const next = { ...p, x: p.x + dx, y: p.y + dy };
      targetRef.current = next;
      return next;
    });
  };
  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    // Only react to the end of a real press. Without this guard a bare
    // pointerleave (cursor exiting the frame with no button down) would re-run
    // the selection below using the stale ref from the previous click.
    if (!d.active) return;
    d.active = false;
    // Drag finished: unfreeze labels so the declutter runs once for the new view.
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (d.moved || status !== "guessing") return;
    // A tap/click (no drag) on a guessable country selects it directly.
    if (d.downId && d.guessable) {
      select(d.downId);
      return;
    }
    // Otherwise the tap landed on the ocean (or non-guessable land). When enabled,
    // snap to the nearest guessable country whose centroid is within the radius.
    if (oceanSnapRadius > 0) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const vx = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
      const vy = ((e.clientY - rect.top) / rect.height) * MAP_HEIGHT;
      // Undo the <g> translate+scale to get base viewBox coords (zoom-independent).
      // The world tiles horizontally for infinite scroll, so a click can land on
      // any wrapped copy; wrap bx back into [0, MAP_WIDTH) before the scan.
      let bx = (vx - tf.x) / tf.k;
      bx = ((bx % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH;
      const by = (vy - tf.y) / tf.k;
      let best: string | null = null;
      let bestD2 = oceanSnapRadius * oceanSnapRadius; // squared radius = the limit
      for (const sh of guessableShapes) {
        const dx = sh.cx - bx;
        const dy = sh.cy - by;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < bestD2) {
          bestD2 = dist2;
          best = sh.id;
        }
      }
      if (best) select(best);
    }
  };

  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  // --- the animator (single rAF loop, three modes) ---
  // zoom: proportional (capless) ease of the scale toward target, keeping the
  //   cursor's world point pinned (focalRef). Velocity ∝ remaining distance, so
  //   there's no max speed: big scrolls whip over, small ones snap, and the view
  //   tracks the target tightly through rapid up-down loops.
  // fly:  exponential ease of the whole transform toward target (reset button),
  //   a quick decelerating glide.
  // arc:  time-driven Van Wijk path (flag-prompt reveal). Eased start AND end so
  //   it never whips, and it zooms out-then-in so the player can follow where the
  //   country is, Google-Maps style.
  const startAnim = useCallback((mode: "zoom" | "fly" | "arc") => {
    modeRef.current = mode;
    if (animRef.current !== null) return; // loop already spinning
    lastTsRef.current = performance.now();
    const step = (now: number) => {
      // Clamp dt so a backgrounded tab (huge gap) doesn't snap the view.
      const dt = Math.min(0.05, Math.max(0, (now - lastTsRef.current) / 1000));
      lastTsRef.current = now;
      const cur = tfRef.current;
      const tgt = targetRef.current;
      if (modeRef.current === "zoom") {
        const a = 1 - Math.exp(-dt / TAU_ZOOM);
        const k = cur.k + (tgt.k - cur.k) * a;
        // Finish once within SNAP_K of target so the last sliver doesn't crawl.
        const done = Math.abs(tgt.k - k) <= tgt.k * SNAP_K;
        const f = focalRef.current;
        // Derive x/y from k so the focal world point stays under the cursor.
        setTf(done ? tgt : { k, x: f.vx - f.wx * k, y: f.vy - f.wy * k });
        animRef.current = done ? null : requestAnimationFrame(step);
        return;
      }
      if (modeRef.current === "arc") {
        const arc = arcRef.current;
        if (!arc) {
          animRef.current = null;
          return;
        }
        const raw = Math.min(1, (now - arc.t0) / arc.dur);
        const view = arc.at(smoother(raw));
        setTf(transformOf(view));
        animRef.current = raw >= 1 ? null : requestAnimationFrame(step);
        return;
      }
      const a = 1 - Math.exp(-dt / TAU_FLY);
      const next: Transform = {
        k: cur.k + (tgt.k - cur.k) * a,
        x: cur.x + (tgt.x - cur.x) * a,
        y: cur.y + (tgt.y - cur.y) * a,
      };
      const done =
        Math.abs(tgt.k - next.k) < tgt.k * 1e-3 &&
        Math.hypot(tgt.x - next.x, tgt.y - next.y) < 0.25;
      setTf(done ? tgt : next);
      animRef.current = done ? null : requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  // --- zoom toward a screen point at constant speed ---
  const zoomToward = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const vx = ((clientX - rect.left) / rect.width) * MAP_WIDTH;
      const vy = ((clientY - rect.top) / rect.height) * MAP_HEIGHT;
      // Pin the world point currently under the cursor, taken from the RENDERED
      // frame so an in-flight glide continues without a jump.
      const cur = tfRef.current;
      const wx = (vx - cur.x) / cur.k;
      const wy = (vy - cur.y) / cur.k;
      focalRef.current = { vx, vy, wx, wy };
      // Compound the scale goal off the *target* so rapid scrolls keep deepening.
      const k = clampK(targetRef.current.k * factor);
      targetRef.current = { k, x: vx - wx * k, y: vy - wy * k };
      startAnim("zoom");
    },
    [startAnim],
  );

  // Quick exponential glide to a target transform (reset button).
  const flyTo = useCallback(
    (target: Transform) => {
      targetRef.current = target;
      startAnim("fly");
    },
    [startAnim],
  );

  // Smooth Van Wijk flight (flag-prompt reveal): zoom out, pan, zoom in, with an
  // eased start so it doesn't lurch. Duration scales with the arc's perceived
  // length S, clamped so short hops still feel deliberate and long flights stay
  // watchable without dragging.
  const flyArc = useCallback(
    (target: Transform) => {
      const { at, S } = interpolateView(viewOf(tfRef.current), viewOf(target));
      const dur = Math.min(2800, Math.max(900, Math.abs(S) * 850));
      arcRef.current = { at, dur, t0: performance.now() };
      targetRef.current = target;
      startAnim("arc");
    },
    [startAnim],
  );

  // Compute the transform that fits a shape's bbox into ~70% of the viewBox,
  // centered. `off` is the horizontal world-copy offset (a multiple of
  // MAP_WIDTH) of the copy to fly into.
  const fitTransform = useCallback(
    (bbox: [number, number, number, number], off: number): Transform => {
      const [x0, y0, x1, y1] = bbox;
      const bw = Math.max(x1 - x0, 1e-3);
      const bh = Math.max(y1 - y0, 1e-3);
      const k = clampK(
        Math.min((MAP_WIDTH * 0.7) / bw, (MAP_HEIGHT * 0.7) / bh),
      );
      const cxb = (x0 + x1) / 2 + off;
      const cyb = (y0 + y1) / 2;
      return { k, x: MAP_WIDTH / 2 - cxb * k, y: MAP_HEIGHT / 2 - cyb * k };
    },
    [],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Normalize delta across deltaMode (pixels / lines / pages) and devices, then
      // map it through exp() so the zoom is proportional and continuous: a gentle
      // trackpad swipe nudges a little, a hard wheel notch more, both smooth.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const norm = Math.max(-200, Math.min(200, e.deltaY * unit));
      zoomToward(e.clientX, e.clientY, Math.exp(-norm * 0.0024));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomToward]);

  // Fly-zoom into the current target country when the flag prompt asks for it
  // (the bumped nonce). The ref is seeded with the mount-time nonce so only a
  // genuine bump *while mounted* fires — remounting (e.g. switching tabs and
  // back) must not replay a past request and zoom on a non-revealed round.
  const handledZoomNonce = useRef(mapZoomNonce);
  useEffect(() => {
    if (mapZoomNonce === handledZoomNonce.current) return;
    handledZoomNonce.current = mapZoomNonce;
    const shape = targetId ? shapeById.get(targetId) : undefined;
    if (!shape) return;
    // Fly into whichever horizontal world-copy is nearest on screen, so the
    // infinite-scroll wrap makes the arc cross the seam the short way instead of
    // sweeping back across every tiled copy. The world repeats every MAP_WIDTH,
    // so snap the target's centroid to the copy closest to the current view
    // center — works no matter how many copies you've scrolled through.
    const cur = tfRef.current;
    const viewCx = (MAP_WIDTH / 2 - cur.x) / cur.k; // current view center, world-x
    const targetCx = (shape.bbox[0] + shape.bbox[2]) / 2; // canonical centroid
    const off = Math.round((viewCx - targetCx) / MAP_WIDTH) * MAP_WIDTH;
    flyArc(fitTransform(shape.bbox, off));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapZoomNonce]);

  const zoomButton = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomToward(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const reset = () => flyTo({ k: 1, x: 0, y: 0 });

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

  // The world tiles horizontally for infinite left-right scroll. Compute the set
  // of copy offsets (in base viewBox coords, multiples of MAP_WIDTH) whose copy
  // intersects the visible viewBox [0, MAP_WIDTH]. At k=1 this is 1-2 copies;
  // zoomed in it is exactly 1 — never more than ~3.
  const copies = useMemo(() => {
    const worldPx = MAP_WIDTH * tf.k; // world width in viewBox units at this zoom
    const out: number[] = [];
    let n = Math.floor(-tf.x / worldPx) - 1;
    while (tf.x + n * worldPx < MAP_WIDTH) {
      if (tf.x + (n + 1) * worldPx > 0) out.push(n * MAP_WIDTH);
      n++;
    }
    return out;
  }, [tf]);

  // The country paths only depend on the fill state, not on pan/zoom. Build them
  // once per fill-state change so panning (which only mutates the wrapping <g>
  // transforms) never forces React to re-render the ~177 paths. The same element
  // array is rendered inside every visible copy.
  const countryPaths = useMemo(
    () =>
      shapes.map((s, i) => (
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
      )),
    [fillFor, status, selectedId, language],
  );

  // Decide which labels to draw for the current view: project each centroid to
  // viewBox space across every visible copy, skip off-screen ones, then greedily
  // reject overlaps. Each kept label is tagged with the copy offset `off` it
  // belongs to so it can be rendered inside the matching copy <g> (where its
  // local x is just s.cx).
  const lastLabelsRef = useRef<
    { id: string; cx: number; cy: number; name: string; off: number }[]
  >([]);
  const visibleLabels = useMemo(() => {
    if (!showLabels) return (lastLabelsRef.current = []);
    // While dragging, reuse the last decluttered set instead of recomputing it
    // every pan frame. The labels sit inside the panned <g>, so they track the
    // map via its transform; only the overlap layout would change, and that can
    // wait until the drag ends. This is what keeps panning smooth.
    if (dragging) return lastLabelsRef.current;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: {
      id: string;
      cx: number;
      cy: number;
      name: string;
      off: number;
    }[] = [];
    for (const s of labelCandidates) {
      const name = countryName(s.id, language, s.rawName);
      const halfW = name.length * LABEL_PX * 0.27 + 2;
      const halfH = LABEL_PX * 0.62;
      for (const off of copies) {
        const sx = tf.x + (s.cx + off) * tf.k;
        const sy = tf.y + s.cy * tf.k;
        if (sx < 0 || sx > MAP_WIDTH || sy < 0 || sy > MAP_HEIGHT) continue;
        const box = {
          x0: sx - halfW,
          y0: sy - halfH,
          x1: sx + halfW,
          y1: sy + halfH,
        };
        const clash = placed.some(
          (p) =>
            box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0,
        );
        if (clash) continue;
        placed.push(box);
        out.push({ id: s.id, cx: s.cx, cy: s.cy, name, off });
      }
    }
    return (lastLabelsRef.current = out);
  }, [showLabels, language, tf, copies, dragging]);

  const labelSize = LABEL_PX / tf.k;

  return (
    <div className="map-wrap">
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
        {/* Outer <g> carries the live pan/zoom; each inner <g> is one horizontal
            world copy, offset by a whole MAP_WIDTH in base coords (static unless
            the visible copy set changes), so panning only mutates this one
            transform string. */}
        <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.k})`}>
          {copies.map((off) => (
            <g key={off} transform={`translate(${off} 0)`}>
              {countryPaths}
              {visibleLabels
                .filter((l) => l.off === off)
                .map((l) => {
                  // Tint the label to match its country once that country is
                  // colored (selection/correct/wrong); else keep dark text.
                  const fill = fillFor(l.id);
                  return (
                    <text
                      key={`l${l.id}`}
                      x={l.cx}
                      y={l.cy}
                      fontSize={labelSize}
                      strokeWidth={labelSize * 0.08}
                      className="country-label"
                      // Inline style (not the `fill` attribute) so it overrides the
                      // .country-label CSS rule, which wins over presentation attributes.
                      // Once the country is colored, use white text with a black halo:
                      // tinting the text to match the fill makes it the same hue as the
                      // country and hard to read, so we go high-contrast instead.
                      style={
                        fill === "#b9c5d0"
                          ? undefined
                          : { fill: "#ffffff", stroke: "#000000" }
                      }
                    >
                      {l.name}
                    </text>
                  );
                })}
            </g>
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
