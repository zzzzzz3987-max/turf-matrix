import { calculateAbilityProfile } from "../../ability-ai.mjs";
import { scoreRecentForm } from "../../form-ai.mjs";
import { buildDistanceProfile } from "../../distance-ai.mjs";
import { enrichPeerRuns } from "../../peer-run-enrichment.mjs";
import { buildIndexContributions, calculateTmIndex } from "../../tm-index-engine.mjs";

export const context = { category: "special", surface: "芝" };
export const factor = (count) => count === 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1;
export const makeWeek = (count = 5) => {
  const horses = [1, 2].map((number) => ({
    number, name: "Horse" + number, horseNumber: number, horseName: "Horse" + number,
    currentRace: { raceDate: "2026-09-12", course: "中山", surface: "芝", distance: 1800 },
    pastRuns: Array.from({ length: count }, (_, i) => ({
      date: "2026-08-" + String(20 - i).padStart(2, "0"), raceName: "PastRace" + i,
      course: "中山", surface: "芝", distance: 1800, fieldSize: 16,
      finishPosition: number === 1 ? 2 : 12, margin: number === 1 ? 0.2 : 2.4, last3F: 34,
    })),
  }));
  const enriched = enrichPeerRuns(horses);
  const saved = enriched.map((horse) => {
    const scores = { ability: calculateAbilityProfile(horse).score, form: scoreRecentForm(horse),
      distance: buildDistanceProfile(horse).score, course: 64, blood: 65, pace: 68 };
    const raw = calculateTmIndex(scores, context);
    const adjusted = Math.round(65 + (raw - 65) * factor(count));
    const { peerRuns, opponentEvidence, ...rest } = horse;
    return { ...rest, tmIndex: adjusted, analysis: {
      rawTmIndex: raw, sampleAdjustment: adjusted - raw,
      goingAdjustment: 0, loadAdjustment: 0, trackBiasAdjustment: 0,
      indexContributions: buildIndexContributions(scores, context),
    } };
  });
  return { meta: { date: "2026-09-12" }, races: [{ bundleId: "test-race", track: "中山", number: 9,
    name: "Test", time: "14:00", distance: 1800, surface: "芝", raceContext: context, horses: saved }] };
};
