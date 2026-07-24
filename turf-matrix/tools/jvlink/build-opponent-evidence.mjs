import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "tools", "jvlink", "output");
const summary = JSON.parse(fs.readFileSync(path.join(outputDir, "intelligence-summary.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "target-horses.json"), "utf8"));
const outputPath = path.join(outputDir, "opponent-evidence.json");

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const gradeTier = (gradeCode) => ({ A: 4, B: 3, C: 2, F: 4, G: 3, H: 2, L: 1 })[gradeCode] ?? 0;
const raceByKey = new Map((summary.pastRaces ?? []).map((race) => [race.raceKey, race]));
const universeByRace = new Map();
const universeByHorse = new Map();

for (const run of summary.recentUniverseRuns ?? []) {
  if (!universeByRace.has(run.raceKey)) universeByRace.set(run.raceKey, []);
  universeByRace.get(run.raceKey).push(run);
  if (!universeByHorse.has(run.bloodRegistrationNumber)) universeByHorse.set(run.bloodRegistrationNumber, []);
  universeByHorse.get(run.bloodRegistrationNumber).push(run);
}

for (const runs of universeByHorse.values()) {
  runs.sort((a, b) => String(a.raceDate).localeCompare(String(b.raceDate)));
}

const targetRunsByHorse = new Map();
for (const run of summary.pastRuns ?? []) {
  if (!targetRunsByHorse.has(run.bloodRegistrationNumber)) targetRunsByHorse.set(run.bloodRegistrationNumber, []);
  targetRunsByHorse.get(run.bloodRegistrationNumber).push(run);
}

const records = [];
for (const horse of manifest.horses ?? []) {
  const targetRuns = (targetRunsByHorse.get(horse.bloodRegistrationNumber) ?? [])
    .sort((a, b) => String(b.raceKey).localeCompare(String(a.raceKey)))
    .slice(0, 10);
  const encounters = [];

  for (const targetRun of targetRuns) {
    const race = raceByKey.get(targetRun.raceKey);
    const field = universeByRace.get(targetRun.raceKey) ?? [];
    const peers = field
      .filter((peer) => peer.bloodRegistrationNumber !== horse.bloodRegistrationNumber)
      .map((peer) => {
        const subsequent = (universeByHorse.get(peer.bloodRegistrationNumber) ?? [])
          .filter((run) => String(run.raceDate) > String(peer.raceDate));
        let laterWins = 0;
        let laterGradedTop3 = 0;
        let laterListedTop3 = 0;
        let bestLaterTier = 0;
        for (const run of subsequent) {
          const laterRace = raceByKey.get(run.raceKey);
          const tier = gradeTier(laterRace?.gradeCode);
          bestLaterTier = Math.max(bestLaterTier, tier);
          if (run.finishPosition === 1) laterWins++;
          if (tier >= 2 && run.finishPosition <= 3) laterGradedTop3++;
          if (tier === 1 && run.finishPosition <= 3) laterListedTop3++;
        }
        const qualityScore = clamp(
          50 +
          Math.min(12, laterWins * 2) +
          Math.min(21, laterGradedTop3 * 7) +
          Math.min(8, laterListedTop3 * 4) +
          bestLaterTier * 2,
          45,
          94,
        );
        const targetFinish = Number(targetRun.finishPosition);
        const peerFinish = Number(peer.finishPosition);
        const relation = Number.isFinite(targetFinish) && Number.isFinite(peerFinish)
          ? targetFinish < peerFinish ? "beat" : targetFinish === peerFinish ? "tie" : "lost"
          : "unknown";
        const relationScore = relation === "beat"
          ? qualityScore + 5
          : relation === "lost" && peerFinish - targetFinish >= -2
            ? qualityScore - 2
            : qualityScore - 7;
        return {
          bloodRegistrationNumber: peer.bloodRegistrationNumber,
          horseName: peer.horseName,
          finishPosition: peer.finishPosition,
          relation,
          laterStarts: subsequent.length,
          laterWins,
          laterGradedTop3,
          laterListedTop3,
          bestLaterTier,
          qualityScore,
          evidenceScore: clamp(relationScore),
        };
      });
    if (peers.length) {
      encounters.push({
        raceKey: targetRun.raceKey,
        raceDate: race?.raceDate ?? targetRun.raceKey.slice(0, 8),
        raceName: race?.raceNameShort10 || race?.raceName || null,
        gradeCode: race?.gradeCode || null,
        finishPosition: targetRun.finishPosition,
        peers,
      });
    }
  }

  const peerEvidence = encounters.flatMap((encounter) => encounter.peers);
  const profiled = peerEvidence.filter((peer) => peer.laterStarts > 0);
  const score = profiled.length
    ? clamp(profiled.reduce((sum, peer) => sum + peer.evidenceScore, 0) / profiled.length)
    : null;
  const strongest = [...profiled]
    .sort((a, b) => b.qualityScore - a.qualityScore || b.laterGradedTop3 - a.laterGradedTop3)
    .slice(0, 5)
    .map((peer) => ({
      horseName: peer.horseName,
      relation: peer.relation,
      qualityScore: peer.qualityScore,
      laterWins: peer.laterWins,
      laterGradedTop3: peer.laterGradedTop3,
    }));

  records.push({
    bloodRegistrationNumber: horse.bloodRegistrationNumber,
    horseName: horse.horseName,
    status: score == null ? "missing" : profiled.length >= 20 ? "active" : "partial",
    score,
    encounterCount: encounters.length,
    peerCount: peerEvidence.length,
    profiledPeerCount: profiled.length,
    strongest,
    encounters,
  });
}

const output = {
  schemaVersion: 1,
  mode: "jvlink-opponent-quality",
  productionWeekDataUpdated: false,
  raceDate: manifest.raceDate,
  source: "JV-Link RCVN/RA/SE",
  targetHorseCount: records.length,
  universeRunCount: summary.recentUniverseRuns?.length ?? 0,
  coveredHorseCount: records.filter((record) => record.score != null).length,
  records,
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  output: outputPath,
  targetHorseCount: output.targetHorseCount,
  coveredHorseCount: output.coveredHorseCount,
  universeRunCount: output.universeRunCount,
}, null, 2));
