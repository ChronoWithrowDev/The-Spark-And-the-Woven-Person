import { useCallback, useEffect, useState, type RefObject } from "react";

// Minimal typings for the prefixed Fullscreen API (older WebKit / iPadOS Safari).
interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

function fsElement(): Element | null {
  const d = document as FsDocument;
  return (
    d.fullscreenElement ?? d.webkitFullscreenElement ?? d.webkitCurrentFullScreenElement ?? d.msFullscreenElement ?? null
  );
}

function canUseRealFullscreen(el: HTMLElement | null): boolean {
  if (!el) return false;
  const e = el as FsElement;
  const supported =
    typeof e.requestFullscreen === "function" ||
    typeof e.webkitRequestFullscreen === "function" ||
    typeof e.webkitRequestFullScreen === "function" ||
    typeof e.msRequestFullscreen === "function";
  // Safari reports support but refuses when the document disallows it
  const d = document as FsDocument;
  const enabled = d.fullscreenEnabled ?? true;
  return supported && enabled !== false;
}

/**
 * Fullscreen with a graceful fallback.
 *
 * Where the Fullscreen API works (desktop browsers, Android, iPadOS) the element
 * is shown fullscreen for real. Where it does not (notably iPhone Safari, which
 * only allows fullscreen for <video>), `fallback` becomes true and the caller
 * expands the player to fill the viewport instead.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const sync = () => {
      const real = !!fsElement() && fsElement() === ref.current;
      setActive((prev) => (real ? true : fallback ? prev : false));
      if (!real) setFallback((fb) => (fb ? fb : false));
    };
    const events = ["fullscreenchange", "webkitfullscreenchange", "MSFullscreenChange"];
    events.forEach((e) => document.addEventListener(e, sync));
    return () => events.forEach((e) => document.removeEventListener(e, sync));
  }, [ref, fallback]);

  // the fallback mode has no browser chrome to press Escape against, so wire it up
  useEffect(() => {
    if (!fallback) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFallback(false);
        setActive(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fallback]);

  // keep the page from scrolling behind the fallback overlay
  useEffect(() => {
    if (!fallback) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fallback]);

  const enter = useCallback(async () => {
    const el = ref.current as FsElement | null;
    if (!el) return;
    if (canUseRealFullscreen(el)) {
      try {
        await (el.requestFullscreen?.() ??
          el.webkitRequestFullscreen?.() ??
          el.webkitRequestFullScreen?.() ??
          el.msRequestFullscreen?.());
        setActive(true);
        return;
      } catch {
        /* denied — fall through to the in-page fallback */
      }
    }
    setFallback(true);
    setActive(true);
  }, [ref]);

  const exit = useCallback(async () => {
    const d = document as FsDocument;
    if (fsElement()) {
      try {
        await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.() ?? d.webkitCancelFullScreen?.() ?? d.msExitFullscreen?.());
      } catch {
        /* ignore */
      }
    }
    setFallback(false);
    setActive(false);
  }, []);

  const toggle = useCallback(() => {
    if (active) void exit();
    else void enter();
  }, [active, enter, exit]);

  return { active, fallback, enter, exit, toggle };
}
