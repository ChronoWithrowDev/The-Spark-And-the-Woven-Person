// Self-export: lets the film save itself as one standalone HTML file.
//
// The production build (vite-plugin-singlefile) inlines all JavaScript and CSS
// into index.html, so the page *is* the whole film. We snapshot the document
// once at startup — before React renders anything into #root — which gives us
// the pristine original markup, including the inline script and styles.
// This works over http(s) and from a local file:// copy (no network needed).

export const EXPORT_FILENAME = "the-spark-and-the-woven-person.html";

let snapshot: string | null = null;

/** Strip anything that would reference an outside file (e.g. scripts injected by a host). */
function sanitize(root: HTMLElement): void {
  const isExternal = (v: string | null) => !!v && !/^(data:|#|blob:)/i.test(v.trim());
  root.querySelectorAll("script[src], link[href], img[src], iframe, source[src]").forEach((el) => {
    const ref = el.getAttribute("src") ?? el.getAttribute("href");
    if (el.tagName === "IFRAME" || isExternal(ref)) el.remove();
  });
  // #root must be empty so React mounts fresh when the copy is opened
  const mount = root.querySelector("#root");
  if (mount) mount.innerHTML = "";
}

/** Call once, before React renders. */
export function captureSource(): void {
  if (snapshot !== null || typeof document === "undefined") return;
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  sanitize(clone);
  snapshot = "<!doctype html>\n" + clone.outerHTML;
}

/** True when the page is a fully inlined build (not the Vite dev server). */
export function isStandaloneBuild(): boolean {
  return !!snapshot && !/<script[^>]+src=/i.test(snapshot) && /<style/i.test(snapshot);
}

export function exportSizeKB(): number {
  return snapshot ? Math.round(new Blob([snapshot]).size / 1024) : 0;
}

export function downloadStandaloneHTML(): boolean {
  if (!snapshot) return false;
  const blob = new Blob([snapshot], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = EXPORT_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
