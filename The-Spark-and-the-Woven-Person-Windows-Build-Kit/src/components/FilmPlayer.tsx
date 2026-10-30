import { useCallback, useEffect, useRef, useState } from "react";
import { VIEW_H, VIEW_W } from "../film/backdrop";
import { AmbientAudio } from "../film/audio";
import { formatTime, PlayableFilm, RendererLike } from "../film/score";
import { useFullscreen } from "../useFullscreen";

export default function FilmPlayer({ film }: { film: PlayableFilm }) {
  const SHOTS = film.shots;
  const TICKS = film.ticks;
  const TOTAL_DURATION = film.duration;
  const shotAt = (t: number) => SHOTS.find((s) => t < s.end) ?? SHOTS[SHOTS.length - 1];

  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RendererLike | null>(null);
  const audioRef = useRef<AmbientAudio | null>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const narrationRef = useRef(false);
  const idleTimer = useRef<number | null>(null);

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [uiTime, setUiTime] = useState(0);
  const [narration, setNarration] = useState(false);
  const [sound, setSound] = useState(false);
  const [idle, setIdle] = useState(false);

  const fs = useFullscreen(shellRef);

  playingRef.current = playing;
  narrationRef.current = narration;

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!rendererRef.current) rendererRef.current = film.createRenderer();
    const renderer = rendererRef.current;

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        const prev = timeRef.current;
        let t = prev + dt;
        if (t >= TOTAL_DURATION) {
          t = TOTAL_DURATION;
          playingRef.current = false;
          setPlaying(false);
          setEnded(true);
        }
        timeRef.current = t;
        // spark / token sounds
        const au = audioRef.current;
        if (au?.enabled) film.cueAudio(prev, t, au);
        setUiTime(t);
      }
      renderer.render(ctx, timeRef.current, { narration: narrationRef.current });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => audioRef.current?.dispose();
  }, []);

  const seek = useCallback(
    (t: number) => {
      const c = Math.max(0, Math.min(TOTAL_DURATION, t));
      timeRef.current = c;
      setUiTime(c);
      if (c < TOTAL_DURATION) setEnded(false);
    },
    [TOTAL_DURATION],
  );

  const togglePlay = useCallback(() => {
    setStarted(true);
    if (timeRef.current >= TOTAL_DURATION) seek(0);
    setPlaying((p) => !p);
  }, [TOTAL_DURATION, seek]);

  const replay = useCallback(() => {
    seek(0);
    setEnded(false);
    setPlaying(true);
    setStarted(true);
  }, [seek]);

  const toggleSound = useCallback(() => {
    if (!audioRef.current) audioRef.current = new AmbientAudio();
    setSound((prev) => {
      const next = !prev;
      audioRef.current?.setEnabled(next);
      return next;
    });
  }, []);

  // ---- hide the controls while the film plays undisturbed in fullscreen ----
  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2600);
  }, []);

  useEffect(() => {
    if (!fs.active || !playing) {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      setIdle(false);
      return;
    }
    wake();
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [fs.active, playing, wake]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing && e.key !== "Escape") return;
      // only claim the keyboard once this player is in use
      if (!fs.active && !started) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "f":
          e.preventDefault();
          fs.toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(timeRef.current - (e.shiftKey ? 1 : 5));
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(timeRef.current + (e.shiftKey ? 1 : 5));
          break;
        case "j":
          e.preventDefault();
          seek(timeRef.current - 10);
          break;
        case "l":
          e.preventDefault();
          seek(timeRef.current + 10);
          break;
        case "m":
          e.preventDefault();
          toggleSound();
          break;
        case "c":
          e.preventDefault();
          setNarration((n) => !n);
          break;
        case "0":
        case "Home":
          e.preventDefault();
          seek(0);
          break;
        default:
          return;
      }
      wake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs, seek, started, togglePlay, toggleSound, wake]);

  const shot = shotAt(uiTime);
  const full = fs.active;
  // in fullscreen the controls float over the film and fade out when idle
  const hidden = full && idle && playing;

  return (
    <div
      ref={shellRef}
      onMouseMove={full ? wake : undefined}
      onTouchStart={full ? wake : undefined}
      className={
        full
          ? `relative ${fs.fallback ? "fixed inset-0 z-50" : "h-screen w-screen"} flex flex-col bg-black ${
              hidden ? "cursor-none" : ""
            }`
          : "overflow-hidden rounded-2xl border border-teal-900/60 bg-[#04181a] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]"
      }
    >
      {/* ---- screen ---- */}
      <div className={full ? "relative min-h-0 flex-1" : "relative"}>
        <canvas
          ref={canvasRef}
          width={VIEW_W}
          height={VIEW_H}
          className={
            full
              ? "absolute inset-0 h-full w-full cursor-pointer object-contain"
              : "block aspect-video w-full cursor-pointer"
          }
          onClick={togglePlay}
          onDoubleClick={fs.toggle}
        />

        {/* opening overlay */}
        {!started && (
          <button
            onClick={togglePlay}
            className="group absolute inset-0 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#04181acc] via-[#04181a99] to-[#04181add] text-center"
          >
            <span className="font-serif text-sm uppercase tracking-[0.5em] text-amber-100/60">
              An animated short
            </span>
            <span className="max-w-xl font-serif text-4xl italic leading-tight text-amber-50 sm:text-5xl">
              {film.title}
            </span>
            <span className="mt-2 flex h-16 w-16 items-center justify-center rounded-full border border-amber-100/40 bg-amber-50/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-amber-50/20">
              <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-amber-50">
                <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.5-6.86a1.03 1.03 0 0 0 0-1.76L9.56 4.26A1.03 1.03 0 0 0 8 5.14z" />
              </svg>
            </span>
            <span className="text-xs tracking-widest text-teal-200/50">
              FILM {film.numeral} · {formatTime(TOTAL_DURATION)} · QUIET · WONDROUS
            </span>
          </button>
        )}

        {/* end overlay */}
        {started && ended && (
          <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-[#04181a99] to-transparent pb-10">
            <button
              onClick={replay}
              className="flex items-center gap-2 rounded-full border border-amber-100/30 bg-[#06221fdd] px-5 py-2.5 text-sm tracking-wide text-amber-50/90 transition hover:bg-[#0a2f2c]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round">
                <path d="M3 12a9 9 0 1 0 2.64-6.36M3 4v5h5" />
              </svg>
              Watch again
            </button>
          </div>
        )}

        {/* pause hint */}
        {started && !playing && !ended && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
              <svg viewBox="0 0 24 24" className="ml-0.5 h-6 w-6 fill-amber-50/90">
                <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.5-6.86a1.03 1.03 0 0 0 0-1.76L9.56 4.26A1.03 1.03 0 0 0 8 5.14z" />
              </svg>
            </span>
          </div>
        )}

        {/* fullscreen affordance, floating over the film */}
        {full && (
          <button
            onClick={fs.toggle}
            aria-label="Exit fullscreen"
            title="Exit fullscreen (Esc)"
            className={`absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-amber-50/80 backdrop-blur-sm transition-opacity duration-500 hover:bg-black/60 hover:text-amber-50 ${
              hidden ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
          >
            <ExitIcon />
          </button>
        )}
      </div>

      {/* ---- controls ---- */}
      <div
        className={`border-t border-teal-900/50 bg-[#051d1e] px-4 py-3 sm:px-5 ${
          full
            ? `absolute inset-x-0 bottom-0 border-t-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent pb-5 pt-10 transition-opacity duration-500 ${
                hidden ? "pointer-events-none opacity-0" : "opacity-100"
              }`
            : ""
        }`}
      >
        {/* spark ticks — one per instance, never overlapping */}
        <div className="relative mb-1.5 h-2.5" aria-hidden>
          {TICKS.map((sp) => {
            const live = uiTime >= sp.start && uiTime <= sp.end;
            const past = uiTime > sp.end;
            return (
              <span
                key={sp.id}
                title={`${film.tickLabel} ${sp.id + 1}`}
                className="absolute top-0.5 h-1 w-1 -translate-x-1/2 rounded-full transition-all duration-300"
                style={{
                  left: `${(sp.t / TOTAL_DURATION) * 100}%`,
                  background: live
                    ? `hsl(${sp.hue}, 95%, 80%)`
                    : past
                      ? `hsla(${sp.hue}, 60%, 70%, 0.35)`
                      : "rgba(94, 160, 150, 0.3)",
                  boxShadow: live ? `0 0 8px hsl(${sp.hue}, 95%, 70%)` : "none",
                  transform: `translateX(-50%) scale(${live ? 1.5 : 1})`,
                }}
              />
            );
          })}
        </div>

        {/* scrubber */}
        <input
          type="range"
          min={0}
          max={TOTAL_DURATION}
          step={0.01}
          value={uiTime}
          onChange={(e) => seek(parseFloat(e.target.value))}
          className="film-scrub w-full"
          style={{ backgroundSize: `${(uiTime / TOTAL_DURATION) * 100}% 100%` }}
          aria-label="Timeline"
        />

        {/* shot segments */}
        <div className="mt-1.5 flex gap-1">
          {SHOTS.map((s) => {
            const active = shot.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  seek(s.start);
                  setStarted(true);
                }}
                title={`Shot ${s.numeral} — ${s.title} (${formatTime(s.start)}–${formatTime(s.end)})`}
                style={{ flexGrow: s.end - s.start }}
                className={`h-6 rounded-sm text-[10px] font-medium tracking-widest transition-colors ${
                  active
                    ? "bg-amber-200/20 text-amber-100"
                    : "bg-teal-950/70 text-teal-300/50 hover:bg-teal-900/60 hover:text-teal-200/80"
                }`}
              >
                {s.numeral}
              </button>
            );
          })}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            onClick={togglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100/10 text-amber-50 transition hover:bg-amber-100/20"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (space)" : "Play (space)"}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-current">
                <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.5-6.86a1.03 1.03 0 0 0 0-1.76L9.56 4.26A1.03 1.03 0 0 0 8 5.14z" />
              </svg>
            )}
          </button>
          <button
            onClick={replay}
            className="flex h-9 w-9 items-center justify-center rounded-full text-teal-200/70 transition hover:bg-teal-900/50 hover:text-teal-100"
            aria-label="Restart"
            title="Restart (0)"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round">
              <path d="M3 12a9 9 0 1 0 2.64-6.36M3 4v5h5" />
            </svg>
          </button>

          <span className="font-mono text-xs tabular-nums text-teal-200/70">
            {formatTime(uiTime)} / {formatTime(TOTAL_DURATION)}
          </span>

          <span className="hidden min-w-0 flex-1 truncate text-xs tracking-wide text-amber-100/60 sm:block">
            Shot {shot.numeral} · {shot.title}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Toggle on={narration} onClick={() => setNarration((n) => !n)} label="Narration" hint="c" />
            <Toggle on={sound} onClick={toggleSound} label="Ambience" hint="m" />
            <button
              onClick={fs.toggle}
              aria-label={full ? "Exit fullscreen" : "Enter fullscreen"}
              title={full ? "Exit fullscreen (f)" : "Fullscreen (f)"}
              className="flex h-9 w-9 items-center justify-center rounded-full text-teal-200/70 transition hover:bg-teal-900/50 hover:text-teal-100"
            >
              {full ? <ExitIcon /> : <EnterIcon />}
            </button>
          </div>
        </div>

        {/* keyboard shortcuts — shown only in the page, not over the film */}
        {!full && (
          <p className="mt-2.5 hidden text-[10px] tracking-wide text-teal-300/35 sm:block">
            <Key>space</Key> play · <Key>f</Key> fullscreen · <Key>←</Key>/<Key>→</Key> 5s ·
            <Key>j</Key>/<Key>l</Key> 10s · <Key>m</Key> ambience · <Key>c</Key> narration ·{" "}
            <Key>0</Key> restart
          </p>
        )}
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded border border-teal-800/60 bg-teal-950/60 px-1 py-px font-mono text-[9px] text-teal-200/60">
      {children}
    </kbd>
  );
}

function EnterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  );
}

function Toggle({
  on,
  onClick,
  label,
  hint,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] tracking-wide transition ${
        on
          ? "border-amber-200/40 bg-amber-100/10 text-amber-100"
          : "border-teal-800/70 text-teal-300/50 hover:border-teal-700 hover:text-teal-200/80"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-amber-300" : "bg-teal-700"}`} />
      {label}
    </button>
  );
}
