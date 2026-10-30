import { formatTime, PlayableFilm } from "../film/score";

export default function Storyboard({ film }: { film: PlayableFilm }) {
  const PRINCIPLES = film.principles;
  const SHOTS = film.shots;
  const NARRATION = film.narration;
  const STYLE_NOTES = film.styleNotes;
  return (
    <div className="space-y-14">
      {/* the central distinction */}
      <section className={`grid gap-4 sm:grid-cols-2 ${PRINCIPLES.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
        {PRINCIPLES.map((p) => (
          <div
            key={p.title}
            className="rounded-xl border border-teal-900/60 bg-[#06201f]/70 p-5"
          >
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-amber-100/10 text-base text-amber-200">
              {p.icon}
            </div>
            <h3 className="font-serif text-lg italic text-amber-50">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-teal-100/60">{p.text}</p>
          </div>
        ))}
      </section>

      {/* shot by shot */}
      <section>
        <h2 className="font-serif text-2xl italic text-amber-50">Shot by shot</h2>
        <div className="mt-6 space-y-4">
          {SHOTS.map((s) => (
            <div
              key={s.id}
              className="group grid gap-3 rounded-xl border border-teal-900/50 bg-[#051d1e]/60 p-5 transition-colors hover:border-teal-800/70 sm:grid-cols-[7rem_1fr]"
            >
              <div>
                <div className="font-serif text-3xl text-amber-200/80">{s.numeral}</div>
                <div className="mt-1 font-mono text-[11px] tracking-wide text-teal-300/50">
                  {formatTime(s.start)} – {formatTime(s.end)}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-100/80">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-teal-100/60">{s.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* narration */}
      <section className="rounded-xl border border-amber-200/10 bg-gradient-to-b from-[#07231f] to-[#05191a] p-7 sm:p-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200/60">
          Narration · calm, neutral voice
        </h2>
        <div className="mt-6 space-y-4">
          {NARRATION.map((line) => (
            <p key={line.start} className="flex items-baseline gap-4">
              <span className="w-10 shrink-0 font-mono text-[11px] text-teal-300/40">
                {formatTime(line.start)}
              </span>
              <span className="font-serif text-lg italic leading-relaxed text-amber-50/90 sm:text-xl">
                “{line.text}”
              </span>
            </p>
          ))}
        </div>
        <p className="mt-6 text-xs leading-relaxed text-teal-200/40">
          If voiceover is unavailable, the story is told entirely through animation and ambient
          sound — no captions, no title cards. Toggle “Narration” on the player to preview the
          timed lines.
        </p>
      </section>

      {/* style notes */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200/60">
          Style notes
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {STYLE_NOTES.map((n) => (
            <span
              key={n}
              className="rounded-full border border-teal-800/60 bg-teal-950/50 px-3.5 py-1.5 text-xs tracking-wide text-teal-100/60"
            >
              {n}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
