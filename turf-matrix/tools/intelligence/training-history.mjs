import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MANIFEST = require("../../data/master/training-history/manifest.json");
const shardCache = new Map();
const normalizeKey = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "").trim();
const compactDate = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 8);

const trainingHistoryShardId = (keyValue) => {
  const key = normalizeKey(keyValue);
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % Number(MANIFEST.shardCount ?? 64)).toString(16).padStart(2, "0");
};

const loadShard = (id) => {
  if (!MANIFEST.populatedShards?.includes(id)) return { records: [] };
  if (!shardCache.has(id)) shardCache.set(id, require(`../../data/master/training-history/${id}.json`));
  return shardCache.get(id);
};

const filterTrainingBefore = (training, raceDateValue) => {
  const raceDate = compactDate(raceDateValue);
  if (!/^\d{8}$/.test(raceDate)) return { slope: [], wood: [] };
  const eligible = (session) => {
    const sessionDate = compactDate(session?.date);
    return /^\d{8}$/.test(sessionDate) && sessionDate < raceDate;
  };
  return {
    slope: (training?.slope ?? []).filter(eligible),
    wood: (training?.wood ?? []).filter(eligible),
  };
};

const trainingHistoryFor = (horse) => {
  const horseName = horse?.horseName ?? horse?.name ?? horse?.currentRace?.horseName;
  const key = normalizeKey(horseName);
  const raceDate = horse?.currentRace?.raceDate ?? horse?.raceDate;
  if (!key || !raceDate) return { slope: [], wood: [], sourceRaceDates: [], status: "missing" };
  const shard = loadShard(trainingHistoryShardId(key));
  const record = shard.records?.find((item) => item.key === key);
  if (!record) return { slope: [], wood: [], sourceRaceDates: [], status: "missing" };
  const training = filterTrainingBefore(record.training, raceDate);
  return {
    ...training,
    sourceRaceDates: (record.sourceRaceDates ?? []).filter((date) => compactDate(date) < compactDate(raceDate)),
    status: training.slope.length || training.wood.length ? "active" : "missing",
  };
};

export {
  MANIFEST as trainingHistoryManifest,
  filterTrainingBefore,
  trainingHistoryFor,
  trainingHistoryShardId,
};
