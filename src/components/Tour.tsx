import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/** One step of a guide. `action` (e.g. switch view / open a panel) runs on entry, then
 * the element matching `selector` is spotlighted. No selector → a centered tooltip. */
export type GuideStep = {
  action?: () => void;
  selector?: string;
  title: string;
  body: string;
};

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(x, max));
}

/** A non-blocking guided overlay: spotlights elements and explains them, while letting
 * the user actually interact with the app (so a feature guide can be tried live). */
export function Tour({ steps, onClose }: { steps: GuideStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i] ?? steps[0];
  const last = i >= steps.length - 1;

  // Run the step's action, then (after a render tick) locate its target.
  useEffect(() => {
    step.action?.();
    if (!step.selector) {
      setRect(null);
      return;
    }
    const sel = step.selector;
    const id = window.setTimeout(() => {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    }, 140);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  useEffect(() => {
    const recompute = () => {
      if (!step.selector) return;
      const el = document.querySelector(step.selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [step.selector]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  const pad = 6;
  const box = rect
    ? { left: rect.left - pad, top: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 }
    : null;

  const TT_W = 320;
  let ttStyle: CSSProperties;
  if (!box || !rect) {
    ttStyle = { left: "50%", top: "42%", transform: "translate(-50%,-50%)", width: TT_W };
  } else if (rect.top < window.innerHeight * 0.55) {
    ttStyle = {
      left: clamp(box.left, 8, window.innerWidth - TT_W - 8),
      top: box.top + box.h + 12,
      width: TT_W,
    };
  } else {
    ttStyle = {
      left: clamp(box.left, 8, window.innerWidth - TT_W - 8),
      top: box.top - 12,
      width: TT_W,
      transform: "translateY(-100%)",
    };
  }

  return createPortal(
    // pointer-events: none on the container so the user can still interact with the app.
    <div className="fixed inset-0 z-[100]" style={{ pointerEvents: "none" }}>
      {box && (
        <div
          style={{
            position: "absolute",
            left: box.left,
            top: box.top,
            width: box.w,
            height: box.h,
            borderRadius: 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            border: "2px solid #818cf8",
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{ ...ttStyle, pointerEvents: "auto" }}
        className="absolute rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-neutral-100">{step.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-neutral-300">{step.body}</p>
        <div className="mt-3 flex items-center gap-2">
          {steps.length > 1 && (
            <span className="text-[10px] text-neutral-500">
              {i + 1} / {steps.length}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
          >
            Fermer
          </button>
          {i > 0 && (
            <button
              onClick={() => setI(i - 1)}
              className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              Précédent
            </button>
          )}
          {!last && (
            <button
              onClick={() => setI(i + 1)}
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Suivant
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
