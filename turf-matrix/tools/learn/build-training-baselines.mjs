#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LEARN_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(LEARN_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const OUTPUT = join(ROOT, "data", "master", "training-baselines.json");
const QUANTILES = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const compactDate = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 8);
const dateValue = (value) => {
  const text = compactDate(value);
  if (!/^\d{8}$/.test(text)) return null;
  return Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)));
};
const daysBefore = (sessionDate, raceDate) => {
  const session = dateValue(sessionDate);
  const race = dateValue(raceDate);
  return session == null || race == null ? null : Math.round((race - session) / 86400000);
};
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const quantile = (values, probability) => {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  return Number(value.toFixed(2));
};
const groupId = (type, horse, session) => {
  if (type === "slope") return `slope-${String(horse.stableSide ?? horse.currentRace?.stableSide ?? "").includes("栗") ? "ritto" : "miho"}`;
  return `wood-${session.course ?? "default"}`;
};

const groups = new Map();
const seen = new Set();
const files = readdirSync(ARCHIVE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}-preodds\.json$/.test(name)).sort();
for (const fileName of files) {
  const snapshot = readJson(join(ARCHIVE_DIR, fileName));
  const raceDate = snapshot.meta?.date ?? fileName.slice(0, 10);
  for (const race of snapshot.races ?? []) {
    for (const horse of race.horses ?? []) {
      for (const [type, sessions] of [["slope", horse.training?.slope ?? []], ["wood", horse.training?.wood ?? []]]) {
        for (const session of sessions) {
          const days = daysBefore(session.date, raceDate);
          if (!Number.isFinite(days) || days < 1 || days > 12) continue;
          const f4 = finite(type === "wood" ? session.times?.["4F"] : session["4F"]);
          const f1 = finite(type === "wood" ? session.times?.["1F"] : session["1F"]);
          if (f4 == null || f1 == null) continue;
          const key = [horse.name ?? horse.horseName, type, session.date, session.course ?? "", f4, f1].join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          const id = groupId(type, horse, session);
          const group = groups.get(id) ?? { id, type, f4: [], f1: [] };
          group.f4.push(f4);
          group.f1.push(f1);
          groups.set(id, group);
          if (type === "wood") {
            const fallback = groups.get("wood-default") ?? { id: "wood-default", type, f4: [], f1: [] };
            fallback.f4.push(f4);
            fallback.f1.push(f1);
            groups.set("wood-default", fallback);
          }
        }
      }
    }
  }
}

const outputGroups = Object.fromEntries([...groups.values()].sort((left, right) => left.id.localeCompare(right.id)).map((group) => [group.id, {
  sampleSize: Math.min(group.f4.length, group.f1.length),
  f4: QUANTILES.map((probability) => ({ probability, value: quantile(group.f4, probability) })),
  f1: QUANTILES.map((probability) => ({ probability, value: quantile(group.f1, probability) })),
}]));
const payload = {
  version: "1.0",
  source: "published pre-odds snapshots; final and one-week sessions only",
  through: files.at(-1)?.slice(0, 10) ?? null,
  policy: {
    resultDataUsed: false,
    popularityOddsUsed: false,
    eligibleDaysBeforeRace: [1, 12],
    minimumSampleSize: 100,
  },
  quantiles: QUANTILES,
  groups: outputGroups,
};
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: OUTPUT, through: payload.through, groups: Object.fromEntries(Object.entries(outputGroups).map(([id, group]) => [id, group.sampleSize])) }, null, 2));
