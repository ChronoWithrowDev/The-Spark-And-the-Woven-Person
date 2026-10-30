import { FilmRenderer } from "./film";
import type { FilmScore, PlayableFilm } from "./score";

/** Wraps a garment-and-spark score (Films I and II) as a playable film. */
export function playableFromScore(score: FilmScore, shortTitle: string): PlayableFilm {
  return {
    id: score.id,
    numeral: score.numeral,
    title: score.title,
    shortTitle,
    kicker: score.kicker,
    intro: score.intro,
    duration: score.duration,
    shots: score.shots,
    narration: score.narration,
    principles: score.principles,
    styleNotes: score.styleNotes,
    ticks: score.sparks.map((sp) => ({ id: sp.id, t: sp.tArrive, start: sp.tEnter, end: sp.tEnd, hue: sp.hue })),
    tickLabel: "Spark",
    createRenderer: () => new FilmRenderer(score),
    cueAudio(prev, t, au) {
      for (const sp of score.sparks) {
        const quick = sp.quick;
        // sparks that pass through the watch sound as they pass, not on arrival
        const tSound = sp.tWatch ?? sp.tArrive;
        if (prev < tSound && t >= tSound) au.chime(sp.tWatch !== undefined ? 44 : sp.hue, quick, quick);
        if (prev < sp.tEnd && t >= sp.tEnd) au.chime(sp.hue + 90, true, quick);
      }
      const wt = score.watch;
      if (wt) {
        if (prev < wt.buildEnd && t >= wt.buildEnd) au.forge();
        // alone in the field, the watch ticks quietly
        if (Math.floor(t) !== Math.floor(prev) && t > wt.buildEnd && score.dissolveAmount(t) > 0.6) au.tick();
      }
    },
  };
}
