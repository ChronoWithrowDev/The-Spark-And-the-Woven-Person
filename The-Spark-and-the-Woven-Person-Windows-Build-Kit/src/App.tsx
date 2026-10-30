import { useEffect, useState } from "react";
import FilmPlayer from "./components/FilmPlayer";
import Storyboard from "./components/Storyboard";
import ExportPanel from "./components/ExportPanel";
import { FILM_ONE } from "./film/timeline";
import { FILM_TWO } from "./film/watchTimeline";
import { FILM_THREE } from "./film/inference";
import { FILM_FOUR } from "./film/current";
import { playableFromScore } from "./film/playable";
import { formatTime, PlayableFilm } from "./film/score";

const FILMS: PlayableFilm[] = [
  playableFromScore(FILM_ONE, "The Spark"),
  playableFromScore(FILM_TWO, "The Golden Watch"),
  FILM_THREE,
  FILM_FOUR,
];
const HASHES = ["#spark", "#golden-watch", "#inference", "#current"];

function filmFromHash(): number {
  if (typeof window === "undefined") return 0;
  const i = HASHES.indexOf(window.location.hash);
  return i >= 0 ? i : 0;
}

export default function App() {
  const [idx, setIdx] = useState(filmFromHash);
  const score = FILMS[idx];

  useEffect(() => {
    const onHash = () => setIdx(filmFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const choose = (i: number) => {
    setIdx(i);
    try {
      history.replaceState(null, "", HASHES[i]);
    } catch {
      /* file:// or sandboxed — selection still works */
    }
  };

  return (
    <div className="min-h-screen bg-[#03100f] text-teal-50 selection:bg-amber-200/30">
      {/* subtle page glow */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,rgba(20,90,80,0.28),transparent_60%)]" />

      <main className="relative mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {/* film selector */}
        <nav className="mb-10 flex justify-center">
          <div className="inline-flex flex-wrap justify-center rounded-3xl border border-teal-900/70 bg-[#051d1e]/80 p-1 sm:rounded-full">
            {FILMS.map((f, i) => {
              const active = i === idx;
              return (
                <button
                  key={f.id}
                  onClick={() => choose(i)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs tracking-wide transition sm:px-5 ${
                    active
                      ? "bg-amber-100/12 text-amber-50 shadow-[inset_0_0_0_1px_rgba(253,230,170,0.25)]"
                      : "text-teal-300/55 hover:text-teal-100"
                  }`}
                >
                  <span className={`font-serif text-sm ${active ? "text-amber-200" : ""}`}>{f.numeral}</span>
                  <span className="hidden sm:inline">{f.shortTitle}</span>
                  <span className="font-mono text-[10px] opacity-60">{formatTime(f.duration)}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <header className="mb-8 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.45em] text-teal-300/50">
            {score.kicker}
          </p>
          <h1 className="mx-auto mt-3 max-w-3xl font-serif text-4xl italic leading-tight text-amber-50 sm:text-5xl">
            {score.title}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-teal-100/55">
            {score.intro} Rendered live, frame by frame, in your browser.
          </p>
        </header>

        <FilmPlayer key={score.id} film={score} />

        <ExportPanel />

        <div className="mt-16">
          <Storyboard film={score} />
        </div>

        <footer className="mt-20 border-t border-teal-900/50 pt-6 text-center text-xs text-teal-300/35">
          Every frame is drawn procedurally on a canvas — threads, sparks, ripples, watercolour
          fields, a golden watch, a turning geometry, and a hand-drawn circuit — following the scores above.
        </footer>
      </main>
    </div>
  );
}
