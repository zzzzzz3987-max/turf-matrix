#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LEARN_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(LEARN_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const OUTPUT_DIR = join(ROOT, "data", "master", "training-history");
const MANIFEST = join(OUTPUT_DIR, "manifest.json");
const SHARD_COUNT = 64;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "").trim();
const compactDate = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 8);
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const shardId = (key) => {
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % SHARD_COUNT).toString(16).padStart(2, "0");
};

const compactSlope = (session) => ({
  date: compactDate(session.date),
  "4F": finite(session["4F"]),
  "3F": finite(session["3F"]),
  "2F": finite(session["2F"]),
  "1F": finite(session["1F"]),
  lap: Object.fromEntries(["lap4", "lap3", "lap2", "lap1"].map((key) => [key, finite(session.lap?.[key])])),
});

const compactWood = (session) => ({
  date: compactDate(session.date),
  course: session.course ?? null,
  direction: session.direction ?? null,
  times: Object.fromEntries([10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((furlong) => [`${furlong}F`, finite(session.times?.[`${furlong}F`])])),
  lap: Object.fromEntries(["lap6", "lap5", "lap4", "lap3", "lap2", "lap1"].map((key) => [key, finite(session.lap?.[key])])),
});

const sessionKey = (type, session) => type === "slope"
  ? [type, session.date, session["4F"], session["3F"], session["2F"], session["1F"]].join("|")
  : [type, session.date, session.course, session.direction, ...Object.values(session.times)].join("|");

const snapshots = readdirSync(ARCHIVE_DIR)
  .filter((name) => /^\d{4}-\d{2}-\d{2}-preodds\.json$/.test(name))
  .sort();
if (!snapshots.length) throw new Error("No pre-odds snapshots found for training history");

const records = new Map();
for (const fileName of snapshots) {
  const snapshot = readJson(join(ARCHIVE_DIR, fileName));
  const sourceDate = fileName.slice(0, 10);
  for (const race of snapshot.races ?? []) {
    for (const horse of race.horses ?? []) {
      const horseName = horse.name ?? horse.horseName;
      const key = normalizeName(horseName);
      if (!key) continue;
      const record = records.get(key) ?? {
        key,
        horseName,
        sourceRaceDates: new Set(),
        slope: new Map(),
        wood: new Map(),
      };
      record.sourceRaceDates.add(sourceDate);
      for (const raw of horse.training?.slope ?? []) {
        const session = compactSlope(raw);
        if (!/^\d{8}$/.test(session.date) || (session["4F"] == null && session["1F"] == null)) continue;
        record.slope.set(sessionKey("slope", session), session);
      }
      for (const raw of horse.training?.wood ?? []) {
        const session = compactWood(raw);
        if (!/^\d{8}$/.test(session.date) || (session.times["4F"] == null && session.times["1F"] == null)) continue;
        record.wood.set(sessionKey("wood", session), session);
      }
      records.set(key, record);
    }
  }
}

const orderedRecords = [...records.values()].map((record) => ({
  key: record.key,
  horseName: record.horseName,
  sourceRaceDates: [...record.sourceRaceDates].sort(),
  training: {
    slope: [...record.slope.values()].sort((left, right) => left.date.localeCompare(right.date)),
    wood: [...record.wood.values()].sort((left, right) => left.date.localeCompare(right.date)),
  },
})).sort((left, right) => left.key.localeCompare(right.key, "ja"));

const payload = {
  version: "1.0",
  source: "published pre-odds snapshots only",
  through: snapshots.at(-1).slice(0, 10),
  policy: {
    resultDataUsed: false,
    popularityOddsUsed: false,
    futureSessionFilterRequired: true,
    dedupe: "horse + type + date + course + clock",
  },
  recordCount: orderedRecords.length,
  sessionCount: orderedRecords.reduce((sum, record) => sum + record.training.slope.length + record.training.wood.length, 0),
};

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const name of readdirSync(OUTPUT_DIR).filter((item) => /^[0-9a-f]{2}\.json$/.test(item))) {
  rmSync(join(OUTPUT_DIR, name));
}
const shards = new Map();
for (const record of orderedRecords) {
  const id = shardId(record.key);
  const values = shards.get(id) ?? [];
  values.push(record);
  shards.set(id, values);
}
for (const [id, values] of [...shards.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  writeFileSync(join(OUTPUT_DIR, `${id}.json`), `${JSON.stringify({ records: values })}\n`, "utf8");
}
writeFileSync(MANIFEST, `${JSON.stringify({ ...payload, shardCount: SHARD_COUNT, populatedShards: [...shards.keys()].sort() }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: MANIFEST,
  snapshotCount: snapshots.length,
  through: payload.through,
  recordCount: payload.recordCount,
  sessionCount: payload.sessionCount,
  shardCount: SHARD_COUNT,
  populatedShards: shards.size,
  fileExists: existsSync(MANIFEST),
}, null, 2));
