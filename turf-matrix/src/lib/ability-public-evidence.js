const dateKey = (value) => {
  const digits = String(value ?? "").replace(/[-/.]/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
};
const finish = (value) => value != null && String(value).trim() &&
  Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export const buildAbilityPublicEvidence = (horse) => {
  const cutoff = dateKey(horse?.currentRace?.raceDate);
  if (!cutoff) return [];
  const encounters = horse?.opponentEvidence?.encounters ?? [];
  const seen = new Set();
  return [...encounters].map((race) => ({ race, date: dateKey(race.raceDate), position: finish(race.finishPosition) }))
    .filter(({ race, date, position }) => date && date < cutoff && position && race.raceName)
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap(({ race, date, position }) => {
      const key = race.raceKey ?? `${date}-${race.raceName}`;
      if (seen.has(key)) return [];
      const peers = (race.peers ?? []).filter(peer => peer.horseName && finish(peer.finishPosition))
        .sort((a, b) => Math.abs(Number(a.finishPosition) - position) - Math.abs(Number(b.finishPosition) - position) ||
          Number(a.finishPosition) - Number(b.finishPosition));
      if (!peers.length) return [];
      seen.add(key);
      const peer = peers[0];
      const peerPosition = Number(peer.finishPosition);
      const result = position < peerPosition ? "に先着" : position === peerPosition ? "と同着" : "が先着";
      return [{ key, date: `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6)}`,
        raceName: race.raceName, position,
        text: `${peer.horseName}（${peerPosition}着）${result}。`,
      }];
    }).slice(0, 3);
};
