import { useState } from "react";
import {
  downloadStandaloneHTML,
  EXPORT_FILENAME,
  exportSizeKB,
  isStandaloneBuild,
} from "../exportPage";

export default function ExportPanel() {
  const [saved, setSaved] = useState(false);
  const standalone = isStandaloneBuild();
  const size = exportSizeKB();

  const onClick = () => {
    if (downloadStandaloneHTML()) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3200);
    }
  };

  return (
    <section className="mt-6 flex flex-col items-start gap-4 rounded-xl border border-teal-900/60 bg-[#051d1e]/70 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="font-serif text-lg italic text-amber-50">Take the film with you</h2>
        <p className="mt-1 text-sm leading-relaxed text-teal-100/55">
          One self-contained HTML file holding all four films. Every thread, spark, sound, and line
          of narration is generated inside it, with no images, fonts, or network requests. Open it
          in any modern browser, even offline. Add{" "}
          <code className="font-mono text-amber-100/70">#golden-watch</code>,{" "}
          <code className="font-mono text-amber-100/70">#inference</code>, or{" "}
          <code className="font-mono text-amber-100/70">#current</code> to the address to open
          straight to Film II, III, or IV.
        </p>
        {!standalone && (
          <p className="mt-2 text-xs text-amber-200/60">
            Running from the development server. Use the production build (
            <code className="font-mono">npm run build</code>) for a standalone export.
          </p>
        )}
      </div>

      <button
        onClick={onClick}
        disabled={!standalone}
        title={EXPORT_FILENAME}
        className="group flex shrink-0 items-center gap-3 rounded-full border border-amber-200/35 bg-amber-100/10 px-5 py-2.5 text-sm tracking-wide text-amber-50 transition hover:border-amber-200/60 hover:bg-amber-100/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saved ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current transition-transform group-hover:translate-y-0.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
          </svg>
        )}
        <span>{saved ? "Saved" : "Download .html"}</span>
        {standalone && size > 0 && (
          <span className="font-mono text-[11px] text-amber-100/50">{size} KB</span>
        )}
      </button>
    </section>
  );
}
