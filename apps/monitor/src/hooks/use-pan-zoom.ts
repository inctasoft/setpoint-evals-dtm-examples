import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
const KEY_PAN_PX = 40;

export interface PanZoomTransform {
  x: number;
  y: number;
  scale: number;
}

/**
 * Wheel-to-cursor zoom + drag pan + keyboard nav, applied as a CSS `transform` on a wrapper div
 * OUTSIDE the mermaid-rendered `<pre>` (ux-storyboards.md §3.1) — no external pan-zoom
 * dependency (capability-spec.md §3.1 risk note: "keep deps flat; ~100 lines of handlers").
 * The wrapper never remounts across a live status update (WorkflowDag's two-phase render only
 * remounts the `<pre>` on a structure change), so the transform survives WS-driven re-renders
 * for free — this hook just owns the number, it doesn't need to "preserve" anything itself.
 */
export function usePanZoom() {
  const [transform, setTransform] = useState<PanZoomTransform>({ x: 0, y: 0, scale: 1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const reset = useCallback(() => setTransform({ x: 0, y: 0, scale: 1 }), []);

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    setTransform((prev) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      const ratio = nextScale / prev.scale;
      // Zoom to a fixed screen point (cursor, or the container center if unset) by keeping that
      // point's position under the cursor stable — standard "zoom to cursor" transform algebra.
      const rect = containerRef.current?.getBoundingClientRect();
      const px = cx ?? (rect ? rect.width / 2 : 0);
      const py = cy ?? (rect ? rect.height / 2 : 0);
      return {
        scale: nextScale,
        x: px - (px - prev.x) * ratio,
        y: py - (py - prev.y) * ratio,
      };
    });
  }, []);

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? e.clientX - rect.left : undefined;
      const cy = rect ? e.clientY - rect.top : undefined;
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, cx, cy);
    },
    [zoomBy],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      // Left button / primary touch only.
      if (e.button !== 0) return;
      // Never capture the pointer for a click destined for a real control (zoom buttons, the
      // job picker, an SVG node) — setPointerCapture on the CONTAINER retargets the eventual
      // click event to the container itself in Chromium, silently swallowing clicks on any
      // interactive descendant. Caught by a real Playwright .click() (which drives an actual
      // pointerdown/up sequence); a synthetic `el.click()` in manual testing never exercises
      // this path, which is exactly how this shipped broken the first time.
      const target = e.target as Element | null;
      if (target?.closest('button, select, a, g.node, [role="button"]')) return;
      dragState.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
      (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId);
    },
    [transform.x, transform.y],
  );

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setTransform((prev) => ({ ...prev, x: dragState.current!.origX + dx, y: dragState.current!.origY + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case '+':
        case '=':
          zoomBy(ZOOM_STEP);
          e.preventDefault();
          break;
        case '-':
        case '_':
          zoomBy(1 / ZOOM_STEP);
          e.preventDefault();
          break;
        case '0':
          reset();
          e.preventDefault();
          break;
        case 'ArrowUp':
          setTransform((prev) => ({ ...prev, y: prev.y + KEY_PAN_PX }));
          e.preventDefault();
          break;
        case 'ArrowDown':
          setTransform((prev) => ({ ...prev, y: prev.y - KEY_PAN_PX }));
          e.preventDefault();
          break;
        case 'ArrowLeft':
          setTransform((prev) => ({ ...prev, x: prev.x + KEY_PAN_PX }));
          e.preventDefault();
          break;
        case 'ArrowRight':
          setTransform((prev) => ({ ...prev, x: prev.x - KEY_PAN_PX }));
          e.preventDefault();
          break;
        default:
          break;
      }
    },
    [zoomBy, reset],
  );

  // Wheel must be a non-passive native listener to preventDefault (page-scroll suppression) —
  // Preact's synthetic onWheel prop is passive by default in some builds, so wire it manually.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  return {
    containerRef,
    transform,
    reset,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
    },
  };
}
