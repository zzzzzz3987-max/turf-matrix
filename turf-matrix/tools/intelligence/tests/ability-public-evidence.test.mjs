import test from "node:test";
import assert from "node:assert/strict";
import { buildAbilityPublicEvidence } from "../../../src/lib/ability-public-evidence.js";
const race = (overrides = {}) => ({ raceKey: "r", raceDate: "2026-08-01", raceName: "特別", finishPosition: 3,
  peers: [{ horseName: "強敵", finishPosition: 2 }, { horseName: "後続", finishPosition: 8 }], ...overrides });
const build = (encounters) => buildAbilityPublicEvidence({ currentRace: { raceDate: "2026-09-01" }, opponentEvidence: { encounters } });
test("public evidence shows the closest rival, even when beaten", () => {
  assert.equal(build([race()])[0].text, "強敵（2着）が先着。");
  assert.equal(build([race({ finishPosition: 1 })])[0].text, "強敵（2着）に先着。");
});
test("future, missing, invalid and duplicate encounters are excluded", () => {
  assert.equal(build([race(), race(), race({ raceDate: "2026-09-01" }), race({ raceDate: null }), race({ finishPosition: 0 })]).length, 1);
  assert.deepEqual(build([race({ peers: [{ horseName: "不明", finishPosition: 0 }] })]), []);
  assert.deepEqual(buildAbilityPublicEvidence({}), []);
});
test("public evidence limits recent races and never exposes score internals", () => {
  const rows = build(Array.from({ length: 5 }, (_, i) => race({ raceKey: String(i), raceDate: `2026-08-0${i + 1}` })));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2026/08/05");
  assert.doesNotMatch(JSON.stringify(rows), /weight|confidence|evidenceScore/);
});
