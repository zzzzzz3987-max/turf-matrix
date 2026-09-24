#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = join(TOOLS_DIR, "..");
const ARCHIVE_DIR = join(REPO_ROOT, "data", "archive");
const OUTPUT_DIR = join(REPO_ROOT, "docs", "analysis");
const PUBLISHED_REVIEW_PATH = join(REPO_ROOT, "docs", "reviews", "2026-09-19-22-results.json");

const ENGINES = [
  ["ability", "Ability"],
  ["distance", "Distance"],
  ["blood", "Blood"],
  ["training", "Training"],
  ["course", "Course"],
  ["pace", "Pace"],
  ["load", "Load"],
  ["trackBias", "Track Bias"],
  ["stable", "Stable"],
  ["form", "Form"],
  ["value", "Value"],
];

const isFiniteNumber = (value) => Number.isFinite(Number(value));
const toNumber = (value) => isFiniteNumber(value) ? Number(value) : null;
const formatNumber = (value, digits = 2) => value == null ? "—" : value.toFixed(digits);
const formatPercent = (hits, total) => total === 0 ? "—" : `${(hits / total * 100).toFixed(1)}%`;
const formatInterval = (interval) => interval == null
  ? "—"
  : `[${formatNumber(interval[0], 3)}, ${formatNumber(interval[1], 3)}]`;

const normalizeHorseName = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\s\u3000]/g, "")
  .replace(/^[*＊$＄]+/, "");

const distanceBand = (distance) => {
  if (!Number.isFinite(Number(distance))) return "距離不明";
  if (Number(distance) <= 1400) return "1400m以下";
  if (Number(distance) <= 1800) return "1500〜1800m";
  if (Number(distance) <= 2200) return "1900〜2200m";
  return "2300m以上";
};

const popularityBand = (popularity) => {
  const rank = Number(popularity);
  if (!Number.isFinite(rank) || rank < 1) return "人気不明";
  if (rank <= 3) return "1〜3番人気";
  if (rank <= 7) return "4〜7番人気";
  return "8番人気以下";
};

const parseRaceTime = (value) => {
  const match = String(value ?? "").trim().match(/^(?:(\d+):)?(\d{1,2})\.(\d)$/);
  if (!match) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2]) + Number(match[3]) / 10;
};

const mean = (values) => values.length === 0
  ? null
  : values.reduce((sum, value) => sum + value, 0) / values.length;

const standardDeviation = (values) => {
  if (values.length === 0) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
};

const averageRanks = (values) => {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[sorted[index].index] = averageRank;
    start = end;
  }
  return ranks;
};

const pearson = (left, right) => {
  if (left.length < 3 || left.length !== right.length) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSum * rightSum);
  return denominator === 0 ? null : numerator / denominator;
};

const spearman = (pairs) => pearson(
  averageRanks(pairs.map(([left]) => left)),
  averageRanks(pairs.map(([, right]) => right)),
);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const collectVerifiedPublishedLeaders = (review) => {
  if (!review) {
    return { availableCount: 0, verified: [], missingCommitCount: 0, hashMismatchCount: 0 };
  }

  const candidates = (review.rows ?? []).filter((row) => (
    row.scope === "allRaceSignals" && row.role === "leader"
  ));
  const sourceByRace = new Map((review.sources ?? []).map((source) => [source.raceId, source]));
  const groups = new Map();
  for (const candidate of candidates) {
    const source = sourceByRace.get(candidate.raceId);
    if (!source?.commit) continue;
    const group = groups.get(source.commit) ?? [];
    group.push({ candidate, source });
    groups.set(source.commit, group);
  }

  const prefix = execFileSync("git", ["rev-parse", "--show-prefix"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const verified = [];
  let missingCommitCount = 0;
  let hashMismatchCount = 0;
  const seen = new Set();

  for (const [commit, entries] of groups) {
    try {
      execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: REPO_ROOT, stdio: "ignore" });
    } catch {
      missingCommitCount += entries.length;
      continue;
    }

    const weekPath = `${prefix}tools/week-data.json`;
    const signalPath = `${prefix}tools/all-race-signals.json`;
    const weekBytes = execFileSync("git", ["show", `${commit}:${weekPath}`], {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    const signalBytes = execFileSync("git", ["show", `${commit}:${signalPath}`], {
      cwd: REPO_ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    const weekHash = sha256(weekBytes);
    const signalHash = sha256(signalBytes);
    if (entries.some(({ source }) => (
      source.weekSha256 !== weekHash || source.signalSha256 !== signalHash
    ))) {
      hashMismatchCount += entries.length;
      continue;
    }

    const signals = JSON.parse(signalBytes.toString("utf8"));
    for (const { candidate, source } of entries) {
      const key = `${candidate.date}:${candidate.raceId}`;
      const startAt = Date.parse(`${candidate.date}T${candidate.time}:00+09:00`);
      const publishedAt = Date.parse(candidate.availableAt);
      const race = (signals.races ?? []).find((item) => item.id === candidate.raceId);
      const top = race?.indexTop;
      const matches = top
        && Number(top.number) === Number(candidate.number)
        && normalizeHorseName(top.name) === normalizeHorseName(candidate.name)
        && Number(top.tmIndex) === Number(candidate.tmIndex);
      const validOutcome = Number.isInteger(Number(candidate.finishPosition))
        && Number(candidate.finishPosition) > 0
        && candidate.abnormalityCode === "0"
        && candidate.payoutAvailable === true;
      if (seen.has(key) || !Number.isFinite(startAt) || !Number.isFinite(publishedAt)
        || publishedAt >= startAt || !matches || !validOutcome) continue;
      seen.add(key);
      verified.push(candidate);
    }
  }

  return {
    availableCount: candidates.length,
    verified,
    missingCommitCount,
    hashMismatchCount,
  };
};

const collectPublishedDetailedRaces = (review, existingRaces) => {
  if (!review) return { races: [], records: [], skippedCount: 0 };
  const sourcesByCommit = new Map();
  for (const source of review.sources ?? []) {
    const sources = sourcesByCommit.get(source.commit) ?? [];
    sources.push(source);
    sourcesByCommit.set(source.commit, sources);
  }
  const resultByDate = new Map();
  const existingIds = new Set(existingRaces.map((race) => `${race.date}:${race.bundleId}`));
  const races = [];
  const records = [];
  let skippedCount = 0;
  const prefix = execFileSync("git", ["rev-parse", "--show-prefix"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();

  for (const [commit, sources] of sourcesByCommit) {
    const weekBytes = execFileSync("git", ["show", `${commit}:${prefix}tools/week-data.json`], {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    const signalBytes = execFileSync("git", ["show", `${commit}:${prefix}tools/all-race-signals.json`], {
      cwd: REPO_ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    const hashesMatch = sources.every((source) => (
      source.weekSha256 === sha256(weekBytes) && source.signalSha256 === sha256(signalBytes)
    ));
    if (!hashesMatch) {
      skippedCount += sources.length;
      continue;
    }
    const week = JSON.parse(weekBytes.toString("utf8").replace(/^\uFEFF/, ""));

    for (const source of sources) {
      const race = (week.races ?? []).find((item) => item.id === source.raceId);
      if (!race || !Array.isArray(race.horses) || race.horses.length === 0) continue;
      const key = `${source.date}:${race.bundleId}`;
      if (existingIds.has(key) || races.some((item) => `${item.date}:${item.bundleId}` === key)) {
        skippedCount += 1;
        continue;
      }
      const raceStart = Date.parse(`${source.date}T${source.time}:00+09:00`);
      const availableAt = Date.parse(source.availableAt);
      if (!Number.isFinite(raceStart) || !Number.isFinite(availableAt) || availableAt >= raceStart) {
        skippedCount += 1;
        continue;
      }

      if (!resultByDate.has(source.date)) {
        const resultPath = join(ARCHIVE_DIR, `${source.date}-all-race-results.json`);
        resultByDate.set(source.date, existsSync(resultPath) ? readJson(resultPath) : null);
      }
      const resultDay = resultByDate.get(source.date);
      const resultRace = resultDay?.Races?.find((result) => (
        result.Race.RaceDate === source.date
        && result.Race.CourseName === race.track
        && Number(result.Race.RaceNo) === Number(race.number)
      ));
      if (!resultRace?.IsFinal || !resultRace.HasPayouts
        || resultRace.Horses.length !== race.horses.length) {
        skippedCount += 1;
        continue;
      }

      const joined = race.horses.map((horse) => {
        const resultHorse = resultRace.Horses.find((item) => Number(item.HorseNumber) === Number(horse.number));
        if (!resultHorse || normalizeHorseName(resultHorse.HorseName) !== normalizeHorseName(horse.name)) return null;
        const factors = Object.fromEntries(ENGINES.map(([factor]) => {
          const detail = horse.analysis?.factorsDetail?.[factor];
          const evaluated = detail?.status === "active" || detail?.status === "partial";
          return [factor, evaluated ? toNumber(detail.score) : null];
        }));
        return {
          date: source.date,
          bundleId: race.bundleId,
          raceName: race.name,
          horseNumber: Number(horse.number),
          horseName: horse.name,
          tmIndex: toNumber(horse.tmIndex ?? horse.aiScore),
          indexRank: toNumber(horse.analysis?.relative?.rank),
          analysisVersion: horse.analysis?.status ?? "unknown",
          surface: race.surface ?? "不明",
          distance: toNumber(race.distance),
          popularity: toNumber(horse.popularity ?? horse.oddsDetail?.popularity),
          finishPosition: toNumber(resultHorse.FinishPosition),
          marginSeconds: null,
          factors,
        };
      });
      if (joined.some((record) => record == null)) {
        skippedCount += 1;
        continue;
      }
      const raceRecords = joined.filter((record) => record.finishPosition != null);
      if (raceRecords.length !== race.horses.length) {
        skippedCount += 1;
        continue;
      }
      races.push({ date: source.date, bundleId: race.bundleId, raceName: race.name, records: raceRecords });
      records.push(...raceRecords);
    }
  }
  return { races, records, skippedCount };
};

const calculatePublishedLeaderStats = ({ verified }) => {
  const count = verified.length;
  const wins = verified.filter((row) => Number(row.finishPosition) === 1).length;
  const topThree = verified.filter((row) => Number(row.finishPosition) <= 3).length;
  const winPayout = verified.reduce((total, row) => total + Number(row.winPayout ?? 0), 0);
  const placePayout = verified.reduce((total, row) => total + Number(row.placePayout ?? 0), 0);
  const stake = count * 100;
  return {
    count,
    wins,
    topThree,
    winPayout,
    placePayout,
    winRoi: stake === 0 ? null : winPayout / stake * 100,
    placeRoi: stake === 0 ? null : placePayout / stake * 100,
  };
};

const resolveArchivePairs = () => readdirSync(ARCHIVE_DIR)
  .map((fileName) => fileName.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .sort()
  .map((date) => ({
    date,
    snapshotPath: join(ARCHIVE_DIR, `${date}-preodds.json`),
    manifestPath: join(ARCHIVE_DIR, `${date}-preodds.manifest.json`),
    resultsPath: join(ARCHIVE_DIR, `${date}-results.json`),
  }))
  .filter(({ resultsPath }) => existsSync(resultsPath));

const findResultRace = (snapshotRace, resultRaces) => resultRaces.find((race) => (
  race.bundleId === snapshotRace.bundleId
));

const findResultHorse = (snapshotHorse, resultHorses) => {
  const horseNumber = Number(snapshotHorse.number ?? snapshotHorse.horseNumber);
  const expectedName = normalizeHorseName(snapshotHorse.name ?? snapshotHorse.horseName);
  const byNumber = resultHorses.find((horse) => Number(horse.horseNumber) === horseNumber);
  if (!byNumber || normalizeHorseName(byNumber.horseName) !== expectedName) return null;
  return byNumber;
};

const collect = (pairs) => {
  const records = [];
  const races = [];
  const warnings = [];
  let skippedRaceCount = 0;
  let skippedHorseCount = 0;
  let verifiedSnapshotCount = 0;

  for (const pair of pairs) {
    if (existsSync(pair.manifestPath)) {
      const manifest = readJson(pair.manifestPath);
      const actualHash = sha256(readFileSync(pair.snapshotPath));
      if (manifest.snapshotSha256 !== actualHash) {
        throw new Error(`${pair.date}: pre-race snapshot hash mismatch`);
      }
      if (manifest.status !== "frozen-pre-race"
        || manifest.policy?.resultReadBeforeFreeze !== false
        || manifest.policy?.futureLeakageAllowed !== false) {
        throw new Error(`${pair.date}: invalid pre-race manifest policy`);
      }
      verifiedSnapshotCount += 1;
    } else {
      warnings.push(`${pair.date}: 旧アーカイブのためSHA256 manifestなし`);
    }
    const snapshot = readJson(pair.snapshotPath);
    const results = readJson(pair.resultsPath);
    for (const snapshotRace of snapshot.races ?? []) {
      const resultRace = findResultRace(snapshotRace, results.races ?? []);
      if (!resultRace) {
        skippedRaceCount += 1;
        warnings.push(`${pair.date} ${snapshotRace.bundleId}: 確定結果レース未検出`);
        continue;
      }

      const winner = (resultRace.horses ?? []).find((horse) => Number(horse.finishPosition) === 1);
      const winnerTime = parseRaceTime(winner?.time);
      const raceRecords = [];

      for (const snapshotHorse of snapshotRace.horses ?? []) {
        const resultHorse = findResultHorse(snapshotHorse, resultRace.horses ?? []);
        if (!resultHorse) {
          skippedHorseCount += 1;
          warnings.push(`${pair.date} ${snapshotRace.bundleId} ${snapshotHorse.number} ${snapshotHorse.name}: 馬番・馬名JOIN失敗`);
          continue;
        }
        const finishPosition = toNumber(resultHorse.finishPosition);
        const raceTime = parseRaceTime(resultHorse.time);
        const marginSeconds = winnerTime != null && raceTime != null
          ? Math.max(0, Number((raceTime - winnerTime).toFixed(1)))
          : null;
        const factors = Object.fromEntries(ENGINES.map(([key]) => {
          const detail = snapshotHorse.analysis?.factorsDetail?.[key];
          const evaluated = detail?.status === "active" || detail?.status === "partial";
          return [key, evaluated ? toNumber(detail.score) : null];
        }));
        const record = {
          date: pair.date,
          bundleId: snapshotRace.bundleId,
          raceName: snapshotRace.name,
          horseNumber: Number(snapshotHorse.number),
          horseName: snapshotHorse.name,
          tmIndex: toNumber(snapshotHorse.tmIndex),
          indexRank: toNumber(snapshotHorse.analysis?.relative?.rank),
          analysisVersion: snapshotHorse.analysis?.status ?? "unknown",
          surface: snapshotRace.surface ?? "不明",
          distance: toNumber(snapshotRace.distance),
          popularity: toNumber(snapshotHorse.popularity ?? snapshotHorse.oddsDetail?.popularity),
          finishPosition,
          marginSeconds,
          factors,
        };
        raceRecords.push(record);
        if (finishPosition != null) records.push(record);
      }

      if (raceRecords.length === 0) {
        skippedRaceCount += 1;
        continue;
      }
      races.push({
        date: pair.date,
        bundleId: snapshotRace.bundleId,
        raceName: snapshotRace.name,
        records: raceRecords,
      });
    }
  }

  return { records, races, warnings, skippedRaceCount, skippedHorseCount, verifiedSnapshotCount };
};

const calculateEngineStats = (records, races) => ENGINES.map(([key, label]) => {
  const scored = records.filter((record) => record.factors[key] != null);
  const values = scored.map((record) => record.factors[key]);
  const finishPairs = scored.map((record) => [record.factors[key], record.finishPosition]);
  const marginPairs = scored
    .filter((record) => record.marginSeconds != null)
    .map((record) => [record.factors[key], record.marginSeconds]);
  const minimum = values.length ? Math.min(...values) : null;
  const maximum = values.length ? Math.max(...values) : null;
  const raceCorrelations = races.map((race) => spearman(race.records
    .filter((record) => record.finishPosition != null && record.factors[key] != null)
    .map((record) => [record.factors[key], record.finishPosition])))
    .filter((value) => value != null);
  const raceMarginCorrelations = races.map((race) => spearman(race.records
    .filter((record) => record.marginSeconds != null && record.factors[key] != null)
    .map((record) => [record.factors[key], record.marginSeconds])))
    .filter((value) => value != null);
  const finishCorrelationInterval = bootstrapMeanInterval(raceCorrelations, `${key}:finish`);
  const marginCorrelationInterval = bootstrapMeanInterval(raceMarginCorrelations, `${key}:margin`);
  return {
    key,
    label,
    count: values.length,
    average: mean(values),
    sd: standardDeviation(values),
    minimum,
    maximum,
    range: minimum == null ? null : maximum - minimum,
    finishCorrelation: spearman(finishPairs),
    marginCorrelation: spearman(marginPairs),
    marginCount: marginPairs.length,
    withinRaceFinishCorrelationMean: mean(raceCorrelations),
    withinRaceFinishCorrelationMedian: median(raceCorrelations),
    withinRaceFinishRaceCount: raceCorrelations.length,
    withinRaceFinishCorrelationInterval: finishCorrelationInterval,
    withinRaceMarginCorrelationMean: mean(raceMarginCorrelations),
    withinRaceMarginRaceCount: raceMarginCorrelations.length,
    withinRaceMarginCorrelationInterval: marginCorrelationInterval,
  };
});

const selectRanked = (race) => [...race.records]
  .filter((record) => record.tmIndex != null)
  .sort((left, right) => (
    (left.indexRank ?? Number.MAX_SAFE_INTEGER) - (right.indexRank ?? Number.MAX_SAFE_INTEGER)
    || right.tmIndex - left.tmIndex
    || left.horseNumber - right.horseNumber
  ));

const selectAtIndexRank = (race, rank) => {
  const ranked = selectRanked(race);
  return ranked.find((record) => record.indexRank === rank) ?? ranked[rank - 1] ?? null;
};

const calculateRankStats = (races) => [1, 2, 3].map((rank) => {
  const selected = races
    .map((race) => selectAtIndexRank(race, rank))
    .filter((record) => record?.finishPosition != null);
  return {
    rank,
    count: selected.length,
    wins: selected.filter((record) => record.finishPosition === 1).length,
    places: selected.filter((record) => record.finishPosition <= 3).length,
  };
});

const FACTOR_SEGMENTS = [
  { dimension: "保存時識別子", key: (record) => record.analysisVersion ?? "unknown" },
  { dimension: "馬場", key: (record) => record.surface ?? "不明" },
  { dimension: "距離", key: (record) => distanceBand(record.distance) },
  { dimension: "各馬の発走前人気", key: (record) => popularityBand(record.popularity) },
];

const buildFactorSegmentGroups = (races, segment) => {
  const keys = [...new Set(races.flatMap((race) => race.records.map(segment.key)))].sort((a, b) => (
    String(a).localeCompare(String(b), "ja", { numeric: true })
  ));
  return keys.map((key) => {
    const groupRaces = [];
    const factorCorrelations = Object.fromEntries(ENGINES
      .filter(([factor]) => factor !== "value")
      .map(([factor]) => [factor, []]));

    for (const race of races) {
      const inGroup = race.records.filter((record) => segment.key(record) === key);
      if (inGroup.length === 0) continue;
      groupRaces.push({ ...race, records: inGroup });
      for (const [factor] of ENGINES) {
        if (factor === "value") continue;
        const pairs = inGroup
          .filter((record) => record.finishPosition != null && record.factors[factor] != null)
          .map((record) => [record.factors[factor], record.finishPosition]);
        const correlation = spearman(pairs);
        if (correlation != null) factorCorrelations[factor].push(correlation);
      }
    }

    const correlations = Object.entries(factorCorrelations)
      .map(([factor, values]) => ({ factor, raceCount: values.length, mean: mean(values) }))
      .filter((item) => item.raceCount >= 6 && item.mean != null)
      .sort((a, b) => a.mean - b.mean);
    const strongest = correlations[0] ?? null;
    const weakest = correlations.at(-1) ?? null;
    return {
      dimension: segment.dimension,
      segment: key,
      raceCount: groupRaces.length,
      horseCount: groupRaces.reduce((total, race) => total + race.records.length, 0),
      strongest,
      weakest,
    };
  });
};

const calculateFactorSegmentStats = (races) => FACTOR_SEGMENTS.flatMap((segment) => (
  buildFactorSegmentGroups(races, segment)
));

const calculateIndexLeaderSegmentStats = (races) => {
  const leaders = races.map((race) => ({ race, leader: selectAtIndexRank(race, 1) }))
    .filter(({ leader }) => leader != null);
  const segments = [
    { dimension: "保存時識別子", key: (record) => record.analysisVersion ?? "unknown" },
    { dimension: "馬場", key: (record) => record.surface ?? "不明" },
    { dimension: "距離", key: (record) => distanceBand(record.distance) },
    { dimension: "指数1位の発走前人気", key: (record) => popularityBand(record.popularity) },
  ];
  return segments.flatMap((segment) => {
    const keys = [...new Set(leaders.map(({ leader }) => segment.key(leader)))].sort((a, b) => (
      String(a).localeCompare(String(b), "ja", { numeric: true })
    ));
    return keys.map((key) => {
      const selected = leaders
        .filter(({ leader }) => segment.key(leader) === key)
        .map(({ leader }) => leader);
      return {
        dimension: segment.dimension,
        segment: key,
        count: selected.length,
        wins: selected.filter((record) => record.finishPosition === 1).length,
        topThree: selected.filter((record) => record.finishPosition <= 3).length,
      };
    });
  });
};

const GAP_BANDS = [
  { label: "0以上1pt未満", test: (gap) => gap >= 0 && gap < 1 },
  { label: "1以上2pt未満", test: (gap) => gap >= 1 && gap < 2 },
  { label: "2以上3pt未満", test: (gap) => gap >= 2 && gap < 3 },
  { label: "3pt以上", test: (gap) => gap >= 3 },
];

const calculateGapStats = (races) => {
  const observations = races.map((race) => {
    const first = selectAtIndexRank(race, 1);
    const second = selectAtIndexRank(race, 2);
    if (!first || !second || first.finishPosition == null) return null;
    return {
      race: `${race.date} ${race.raceName}`,
      first,
      second,
      gap: first.tmIndex - second.tmIndex,
      firstPlaced: first.finishPosition <= 3,
    };
  }).filter(Boolean);

  return GAP_BANDS.map((band) => {
    const selected = observations.filter(({ gap }) => band.test(gap));
    return {
      label: band.label,
      count: selected.length,
      firstPlaced: selected.filter(({ firstPlaced }) => firstPlaced).length,
    };
  });
};

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const bootstrapMeanInterval = (values, seedText) => {
  if (values.length < 2) return null;
  let seed = [...seedText].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  const estimates = Array.from({ length: 5000 }, () => mean(
    Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]),
  )).sort((left, right) => left - right);
  return [estimates[124], estimates[4874]];
};

const buildFindings = (engineStats, gapStats) => {
  const bySd = [...engineStats].filter((item) => item.sd != null).sort((a, b) => b.sd - a.sd);
  const largestSd = bySd[0];
  const populatedGaps = gapStats.filter((item) => item.count > 0);
  const narrow = populatedGaps[0];
  const wider = populatedGaps.at(-1);
  const gapConclusion = populatedGaps.length < 2
    ? "比較可能な差帯が2区分未満のため判定不能"
    : narrow.firstPlaced / narrow.count < wider.firstPlaced / wider.count
      ? "小さい差帯ほど1位複勝率が低い傾向を観測"
      : "小さい差帯ほど低下する傾向は現サンプルでは未確認";

  return {
    largestSd,
    gapConclusion,
  };
};

const renderReport = ({ pairs, collected, engineStats, rankStats, gapStats, factorSegmentStats, leaderSegmentStats, findings, publishedReview, publishedLeaderStats, outputDate }) => {
  const describeFactor = (item) => item == null
    ? "—"
    : `${ENGINES.find(([key]) => key === item.factor)?.[1]} (${formatNumber(item.mean, 3)}, ${item.raceCount}R)`;
  const engineRows = engineStats.map((item) => (
    `| ${item.label} | ${item.count} | ${formatNumber(item.average)} | ${formatNumber(item.sd)} | ${formatNumber(item.minimum, 0)} | ${formatNumber(item.maximum, 0)} | ${formatNumber(item.range, 0)} |`
  )).join("\n");
  const correlationRows = engineStats.map((item) => (
    `| ${item.label} | ${item.count} | ${formatNumber(item.finishCorrelation, 3)} | ${item.withinRaceFinishRaceCount} | ${formatNumber(item.withinRaceFinishCorrelationMean, 3)} | ${formatInterval(item.withinRaceFinishCorrelationInterval)} | ${item.marginCount} | ${formatNumber(item.marginCorrelation, 3)} | ${item.withinRaceMarginRaceCount} | ${formatNumber(item.withinRaceMarginCorrelationMean, 3)} | ${formatInterval(item.withinRaceMarginCorrelationInterval)} |`
  )).join("\n");
  const rankRows = rankStats.map((item) => (
    `| ${item.rank}位 | ${item.count} | ${item.wins} | ${formatPercent(item.wins, item.count)} | ${item.places} | ${formatPercent(item.places, item.count)} |`
  )).join("\n");
  const gapRows = gapStats.map((item) => (
    `| ${item.label} | ${item.count} | ${item.firstPlaced} | ${formatPercent(item.firstPlaced, item.count)} |`
  )).join("\n");
  const factorSegmentRows = factorSegmentStats.map((item) => (
    `| ${item.dimension} | ${item.segment} | ${item.raceCount} | ${item.horseCount} | ${describeFactor(item.strongest)} | ${describeFactor(item.weakest)} |`
  )).join("\n");
  const leaderSegmentRows = leaderSegmentStats.map((item) => (
    `| ${item.dimension} | ${item.segment} | ${item.count} | ${item.wins} (${formatPercent(item.wins, item.count)}) | ${item.topThree} (${formatPercent(item.topThree, item.count)}) |`
  )).join("\n");
  const factorOrder = [...engineStats]
    .filter((item) => item.key !== "value" && item.withinRaceFinishCorrelationMean != null)
    .sort((a, b) => a.withinRaceFinishCorrelationMean - b.withinRaceFinishCorrelationMean);
  const warnings = [...collected.warnings];
  if (collected.skippedPublishedDetailedCount > 0) {
    warnings.push(`公開コミットの詳細レース照合で${collected.skippedPublishedDetailedCount}件を除外`);
  }
  const warningList = warnings.length
    ? warnings.map((warning) => `- ${warning}`).join("\n")
    : "- なし";
  const unmatchedPublishedCount = publishedReview.availableCount - publishedLeaderStats.count;
  const publishedVerificationNote = unmatchedPublishedCount === 0
    ? `回顧記録の${publishedReview.availableCount}レースすべてで、発走前の公開コミットと2つのデータハッシュを照合し、公開時の指数1位・確定着順・払戻まで一致しました。`
    : `回顧記録の${publishedReview.availableCount}レースのうち、発走前の公開コミットと2つのデータハッシュを照合し、公開時の指数1位・確定着順・払戻まで一致した${publishedLeaderStats.count}レースだけを追加集計しています。残る${unmatchedPublishedCount}レースは出典を確認できず未算入です（コミット欠落: ${publishedReview.missingCommitCount}レース、ハッシュ不一致: ${publishedReview.hashMismatchCount}レース）。`;

  return `# Engine Statistics ${outputDate}

## 対象

- 既存の公開スナップショット・確定結果ペア: ${pairs.length}日分（${pairs.map(({ date }) => date).join("、")}）
- SHA256検証済みスナップショット: ${collected.verifiedSnapshotCount}日分
- 公開コミットから追加した詳細レース: ${collected.publishedDetailedRaceCount}
- 因子集計の対象レース: ${collected.races.length}
- 因子集計の対象馬: ${collected.records.length}
- 着順データなしでスキップしたレース: ${collected.skippedRaceCount}
- JOINできずスキップした馬: ${collected.skippedHorseCount}
- 公開履歴から追加照合した指数1位: ${publishedLeaderStats.count}レース（因子別集計とは別枠）

> **サンプル注意:** 現状は${collected.races.length}レース・${collected.records.length}頭です。追加分18レースは直近4日間の特別レースに偏り、過去126レースとも独立標本ではありません。係数変更や重み最適化を決定できる量ではなく、複数週・開催条件をまたいで再検証します。

## 集計方法

- エンジン値は公開時スナップショットの\`analysis.factorsDetail.<engine>.score\`を使用。
- 追加した詳細18レースは、公開コミットと入力ハッシュを照合したweek-dataを使い、確定結果ファイルと日付・競馬場・レース番号・全馬番・馬名を結合。公開時刻が発走前で、確定着順と払戻が揃うレースだけを採用。
- \`status\`が\`active\`または\`partial\`の項目だけを集計。欠損・監視のみの点数は除外し、実スコア0点とは区別。
- 着順は確定結果の数値着順を使用。除外・中止は着順相関から除外。
- 着差は各馬の走破時計から同レース勝ち馬の走破時計を引いた秒数。時計欠損は着差相関から除外。
- 相関は同順位に平均順位を与えたSpearman順位相関。
- 主指標は各レース内で算出した相関の平均。レースごとの頭数・点数水準の違いをまたいで混ぜない。全馬をまとめた相関は参考値。
- 全レース信号72件の大半は指数1位のみの要約データ。全馬の因子点が保存された詳細18レースだけを因子集計に追加し、指数1位だけの記録は混ぜない。
- 高スコアほど着順・着差が小さい想定のため、**負の相関ほど期待方向に強い**。
- 標準偏差は対象母集団の母標準偏差（N除算）。

## 1. エンジンスコア分布

| Engine | n | 平均 | 標準偏差 | 最小 | 最大 | レンジ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${engineRows}

## 2. 着順・着差とのSpearman相関

レース内ρの平均を主指標として、レース単位で測定。負の値ほど「高得点ほど上位」の関係を示します。

| Engine | 有効馬n | 全馬ρ（着順） | レース内対象 | レース内ρ平均 | 95% CI | 着差n | 全馬ρ（着差） | 着差レース数 | レース内着差ρ平均 | 95% CI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${correlationRows}

95% CIはレース単位のブートストラップ区間（5,000回、参考値）。0をまたぐ場合、関係の方向はこの標本から明瞭とは言えません。開催日単位の偏りは補正していません。

## 3. TM INDEX 1位−2位差と1位複勝率

差帯は重複を避けるため、0〜1ptを「0以上1未満」、1〜2ptを「1以上2未満」として扱います。

| 1位−2位差 | レース数 | 1位3着内 | 1位複勝率 |
| --- | ---: | ---: | ---: |
${gapRows}

**検証所見:** ${findings.gapConclusion}。ただし各帯のレース数が少なく、現時点では仮説の採否を決めません。

## 4. TM INDEX順位別成績

| INDEX順位 | 対象 | 1着 | 勝率 | 3着内 | 複勝率 |
| --- | ---: | ---: | ---: | ---: | ---: |
${rankRows}

## 5. 追加で照合できた公開指数1位

${publishedVerificationNote}

| 対象 | 1着 | 勝率 | 3着内 | 複勝率 | 単勝回収率 | 複勝回収率 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 検証済み公開指数1位 | ${publishedLeaderStats.wins} / ${publishedLeaderStats.count} | ${formatPercent(publishedLeaderStats.wins, publishedLeaderStats.count)} | ${publishedLeaderStats.topThree} / ${publishedLeaderStats.count} | ${formatPercent(publishedLeaderStats.topThree, publishedLeaderStats.count)} | ${formatNumber(publishedLeaderStats.winRoi, 1)}% | ${formatNumber(publishedLeaderStats.placeRoi, 1)}% |

回収率は各レース100円購入と仮定した払戻ベースの参考値で、実際の購入成績ではありません。この追加記録は指数1位だけを含み全出走馬の因子スコアを含まないため、上の因子相関・順位統計の母数には混ぜていません。

## 6. 世代・条件別の探索

### 因子の相関

| 区分 | グループ | 対象レース | 対象馬 | 強い因子（レース内ρ平均） | 弱い因子（レース内ρ平均） |
| --- | --- | ---: | ---: | --- | --- |
${factorSegmentRows}

### TM INDEX 1位の成績

| 区分 | グループ | 対象レース | 1着 | 3着内 |
| --- | --- | ---: | ---: | ---: |
${leaderSegmentRows}

保存時識別子は各スナップショットの記録値です。\`preodds\`はモデル版番号のない旧形式で、\`tm-index-v1.5\`や\`tm-index-v1.7\`との世代比較には使えません。馬場は芝・ダート・障害、距離は1400m以下／1500〜1800m／1900〜2200m／2300m以上、人気は発走前オッズ順位で分類。因子相関は各グループ内のレースごとにSpearman相関を算出し、6レース以上ある因子のうち強弱端を表示。Valueは市場人気を含むため除外しました。指数1位の人気帯成績は、指数1位馬自身の発走前人気で分類しています。

これは条件差を見つけるための探索表です。グループ間の件数・開催日・競走条件が揃っておらず、多重比較も補正していません。表の順位だけで因子の重みや予想ルールを変更しません。人気帯別因子相関は同一レース内でも対象馬が限られるため、相関を計算できたレース数を併記しています。

## 自動所見

### 標準偏差が最大のエンジン

**${findings.largestSd?.label ?? "該当なし"}**（SD ${formatNumber(findings.largestSd?.sd)} / range ${formatNumber(findings.largestSd?.range, 0)}）。分散が大きいことだけで撹乱源とは断定できませんが、順位への影響が相対的に強い可能性があります。

### レース内相関の観測順

${factorOrder.length ? `期待方向の関係が強かった項目: **${factorOrder.slice(0, 3).map((item) => `${item.label}（平均ρ ${formatNumber(item.withinRaceFinishCorrelationMean, 3)} / ${item.withinRaceFinishRaceCount}レース）`).join("、")}**。弱かった項目: ${factorOrder.slice(-3).reverse().map((item) => `${item.label}（平均ρ ${formatNumber(item.withinRaceFinishCorrelationMean, 3)} / ${item.withinRaceFinishRaceCount}レース）`).join("、")}。` : "判定可能な因子なし。"}

これは予測力の確定や因果関係を示しません。Valueは市場評価を含むため、能力系因子の強弱比較から除外しています。調教・馬場など欠損の多い因子は対象レース数も併記して解釈します。対象レースは同日の開催にまとまっているため、CIは日付単位の偏りを補正していません。

### 僅差帯の非情報性

${findings.gapConclusion}。帯別件数が小さいため、結論ではなく継続観測対象です。

## スキップ・警告

${warningList}

## 結論

本レポートはSprint 1（計測）のみを実施したものです。TM INDEX、各エンジンの重み、正規化、タイブレーク、Valueロジックは変更していません。
`;
};

const main = () => {
  if (!existsSync(ARCHIVE_DIR)) throw new Error(`Archive directory was not found: ${ARCHIVE_DIR}`);
  const pairs = resolveArchivePairs();
  if (pairs.length === 0) throw new Error("No publication snapshot/result pairs were found in data/archive");

  const collected = collect(pairs);
  if (collected.races.length === 0 || collected.records.length === 0) {
    throw new Error("No completed races with matched horse results were available for analysis");
  }

  const publishedReviewData = existsSync(PUBLISHED_REVIEW_PATH) ? readJson(PUBLISHED_REVIEW_PATH) : null;
  const detailedPublished = collectPublishedDetailedRaces(publishedReviewData, collected.races);
  const existingPublishedRaces = collected.races;
  const allRaces = [...existingPublishedRaces, ...detailedPublished.races];
  const allRecords = [...collected.records, ...detailedPublished.records];
  const reportCollection = {
    ...collected,
    races: allRaces,
    records: allRecords,
    publishedDetailedRaceCount: detailedPublished.races.length,
    skippedPublishedDetailedCount: detailedPublished.skippedCount,
  };
  const engineStats = calculateEngineStats(allRecords, allRaces);
  const rankStats = calculateRankStats(allRaces);
  const gapStats = calculateGapStats(allRaces);
  const factorSegmentStats = calculateFactorSegmentStats(allRaces);
  const leaderSegmentStats = calculateIndexLeaderSegmentStats(allRaces);
  const publishedReview = collectVerifiedPublishedLeaders(publishedReviewData);
  const publishedLeaderStats = calculatePublishedLeaderStats(publishedReview);
  const findings = buildFindings(engineStats, gapStats);
  const outputDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const report = renderReport({ pairs, collected: reportCollection, engineStats, rankStats, gapStats, factorSegmentStats, leaderSegmentStats, findings, publishedReview, publishedLeaderStats, outputDate });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `engine-stats-${outputDate}.md`);
  writeFileSync(outputPath, report, "utf8");

  console.log(`[analyze:engines] snapshots/results: ${pairs.length}`);
  console.log(`[analyze:engines] analyzed races: ${allRaces.length} (published detailed: ${detailedPublished.races.length})`);
  console.log(`[analyze:engines] analyzed horses: ${allRecords.length}`);
  console.log(`[analyze:engines] verified published leaders: ${publishedLeaderStats.count}/${publishedReview.availableCount}`);
  console.log(`[analyze:engines] skipped races: ${collected.skippedRaceCount}`);
  console.log(`[analyze:engines] skipped horses: ${collected.skippedHorseCount}`);
  console.log(`[analyze:engines] report: ${outputPath}`);
  console.log(`[analyze:engines] largest SD: ${findings.largestSd?.label ?? "n/a"} (${formatNumber(findings.largestSd?.sd)})`);
  console.log(`[analyze:engines] gap finding: ${findings.gapConclusion}`);
};

try {
  main();
} catch (error) {
  console.error(`[analyze:engines] ${error.message}`);
  process.exit(1);
}
