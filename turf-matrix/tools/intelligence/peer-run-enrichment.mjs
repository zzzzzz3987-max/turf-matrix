const raceRunKey = (run) =>
  [run.date, run.course, run.raceName, run.distance].map((value) => String(value ?? "").trim()).join("|");

export const enrichPeerRuns = (horses, opponentByRegistration = new Map()) => {
  const grouped = new Map();
  for (const horse of horses) {
    for (const run of horse.pastRuns ?? []) {
      const key = raceRunKey(run);
      if (!key.replace(/\|/g, "")) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ horseName: horse.horseName, horseNumber: horse.horseNumber, run });
    }
  }

  return horses.map((horse) => {
    const peerRuns = [];
    for (const run of horse.pastRuns ?? []) {
      const peers = (grouped.get(raceRunKey(run)) ?? [])
        .filter((item) => item.horseName !== horse.horseName)
        .map((item) => ({
          horseName: item.horseName,
          horseNumber: item.horseNumber,
          finishPosition: item.run.finishPosition,
          margin: item.run.margin,
        }));
      if (peers.length) {
        peerRuns.push({
          date: run.date,
          course: run.course,
          raceName: run.raceName,
          grade: run.grade,
          distance: run.distance,
          finishPosition: run.finishPosition,
          margin: run.margin,
          peers,
        });
      }
    }
    const registrationNumber = horse.currentRace?.horseId ?? horse.pedigree?.bloodRegistrationNumber;
    return {
      ...horse,
      peerRuns,
      opponentEvidence: registrationNumber ? opponentByRegistration.get(registrationNumber) ?? null : null,
    };
  });
};
