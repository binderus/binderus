/**
 * Description: Drag-to-resize hook for right- or left-anchored side panels.
 *   Returns the current width in `vw` plus a ResizeHandle component to render
 *   on the inner edge of the panel. Width persists to localStorage so panels
 *   remember the user's preferred size across sessions.
 * Inputs: storageKey, side ('left'|'right'), initialVw, optional min/max.
 * Outputs: `{ widthVw, ResizeHandle }`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  storageKey: string;
  side: 'left' | 'right';
  initialVw: number;
  minVw?: number;
  maxVw?: number;
}

function readStored(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, vw: number): void {
  try {
    localStorage.setItem(key, String(vw));
  } catch { /* quota or private mode — ignore */ }
}

export function useResizableWidth({
  storageKey,
  side,
  initialVw,
  minVw = 20,
  maxVw = 80,
}: Options) {
  const [widthVw, setWidthVw] = useState<number>(() => readStored(storageKey) ?? initialVw);
  const draggingRef = useRef(false);

  // Persist after dragging stops (not on every mousemove — avoids localStorage churn).
  useEffect(() => {
    if (draggingRef.current) return;
    writeStored(storageKey, widthVw);
  }, [storageKey, widthVw]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      // Right panel: width grows as pointer moves LEFT of the right edge.
      // Left panel: width grows as pointer moves RIGHT of the left edge.
      const vw = window.innerWidth;
      const px = side === 'right' ? vw - ev.clientX : ev.clientX;
      const next = Math.min(maxVw, Math.max(minVw, (px / vw) * 100));
      setWidthVw(next);
    };

    const up = () => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidthVw((w) => {
        writeStored(storageKey, w);
        return w;
      });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [side, minVw, maxVw, storageKey]);

  const ResizeHandle = useCallback(() => (
    <div
      onPointerDown={onPointerDown}
      className="absolute top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--color-accent)]/40 active:bg-[var(--color-accent)]/60 transition-colors z-10"
      style={{ [side === 'right' ? 'left' : 'right']: -3 }}
      title="Drag to resize"
    />
  ), [onPointerDown, side]);

  return { widthVw, ResizeHandle };
}
