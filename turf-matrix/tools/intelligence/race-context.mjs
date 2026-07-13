const distanceProfile = (distance) => {
  if (distance <= 1400) return { label: "短距離", speed: 1, power: 0.75, stamina: 0.35, sustain: 0.55 };
  if (distance <= 1800) return { label: "マイル・中距離", speed: 0.8, power: 0.65, stamina: 0.55, sustain: 0.7 };
  if (distance <= 2400) return { label: "中距離", speed: 0.55, power: 0.65, stamina: 0.85, sustain: 1 };
  return { label: "長距離", speed: 0.35, power: 0.6, stamina: 1, sustain: 0.9 };
};

const isDirtSurface = (surface) => surface === "ダ" || surface === "ダート";

const buildRaceContext = (race) => {
  const distance = Number(race?.distance) || 0;
  const surface = race?.surface ?? null;
  const profile = distanceProfile(distance);
  const dirt = isDirtSurface(surface);
  const category = race?.grade ? "grade" : "special";
  const condition = [race?.weather, race?.going].filter(Boolean).join("・") || "馬場情報取得待ち";

  const traits = {
    speed: profile.speed,
    power: Math.min(1, profile.power + (dirt ? 0.25 : 0)),
    stamina: profile.stamina,
    sustain: profile.sustain,
  };

  return {
    raceId: race?.id ?? `${race?.raceDate ?? "unknown"}-${race?.course ?? "unknown"}-${race?.raceNo ?? 0}R`,
    date: race?.raceDate ?? null,
    course: race?.course ?? race?.track ?? null,
    raceNo: race?.raceNo ?? race?.number ?? null,
    raceName: race?.raceName ?? race?.name ?? null,
    grade: race?.grade ?? null,
    category,
    depth: category === "grade" ? "full" : "lite",
    surface,
    distance,
    weather: race?.weather ?? null,
    going: race?.going ?? null,
    condition,
    profile: profile.label,
    traits,
    summary: `${race?.course ?? race?.track ?? "開催場未取得"}${surface ?? ""}${distance || "—"}m・${profile.label}・${condition}`,
  };
};

export { buildRaceContext };
