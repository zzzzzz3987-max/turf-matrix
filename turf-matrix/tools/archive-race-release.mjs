#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const WEEK_DATA_PATH = join(TOOLS_DIR, "week-data.json");
const ARCHIVE_DIR = join(REPO_ROOT, "data", "archive");

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const readWeekData = () => JSON.parse(readFileSync(WEEK_DATA_PATH, "utf8"));
const archiveName = (date, suffix) => join(ARCHIVE_DIR, `${date}-${suffix}`);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const buildResultTemplate = (weekData) => {
  const rows = [[
    "場所",
    "R",
    "馬番",
    "馬名",
    "TM_INDEX",
    "指数順位",
    "人気",
    "乖離度",
    "単勝オッズ",
    "EV",
    "妙味フラグ",
    "馬場",
    "天候",
    "着順",
    "払戻",
  ]];
  for (const race of weekData.races ?? []) {
    for (const horse of race.horses ?? []) {
      const value = horse.analysis?.factorsDetail?.value ?? horse.analysis?.value ?? {};
      const indexRank = value.indexRank ?? horse.analysis?.relative?.rank ?? "";
      const marketGap = Number.isFinite(value.marketGap)
        ? value.marketGap
        : Number.isFinite(horse.popularity) && Number.isFinite(indexRank)
          ? horse.popularity - indexRank
          : "";
      rows.push([
        race.track ?? race.course ?? "",
        race.number ?? race.raceNo ?? "",
        horse.number ?? horse.horseNumber ?? "",
        horse.name ?? horse.horseName ?? "",
        horse.tmIndex ?? horse.aiScore ?? "",
        indexRank,
        horse.popularity ?? "",
        marketGap,
        horse.odds ?? horse.oddsDetail?.winOdds ?? "",
        value.ev ?? "",
        value.highlighted === true || value.eligible === true ? "TRUE" : "FALSE",
        race.going ?? "",
        race.weather ?? "",
        "",
        "",
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
};

const main = () => {
  if (!existsSync(WEEK_DATA_PATH)) {
    throw new Error(`week-data.json was not found: ${WEEK_DATA_PATH}`);
  }
  mkdirSync(ARCHIVE_DIR, { recursive: true });

  const weekDataRaw = readFileSync(WEEK_DATA_PATH, "utf8");
  const weekData = JSON.parse(weekDataRaw);
  const date = weekData.meta?.date ?? weekData.races?.[0]?.id?.slice(0, 10);
  if (!date) throw new Error("Archive date could not be resolved from week-data.json");

  const snapshotPath = archiveName(date, "preodds.json");
  const manifestPath = archiveName(date, "preodds.manifest.json");
  const templatePath = archiveName(date, "result-template.csv");
  const frozenSnapshot = weekDataRaw.endsWith("\n") ? weekDataRaw : `${weekDataRaw}\n`;
  const snapshotSha256 = sha256(frozenSnapshot);
  if (existsSync(snapshotPath)) {
    const existingSha256 = sha256(readFileSync(snapshotPath));
    if (existingSha256 !== snapshotSha256) {
      throw new Error(`Pre-race snapshot is already frozen with different content: ${snapshotPath}`);
    }
  } else {
    writeFileSync(snapshotPath, frozenSnapshot);
  }
  const manifest = {
    schemaVersion: 1,
    status: "frozen-pre-race",
    raceDate: date,
    frozenAt: new Date().toISOString(),
    snapshot: `data/archive/${date}-preodds.json`,
    snapshotSha256,
    engineFingerprint: weekData.meta?.engineFingerprint ?? null,
    policy: {
      resultReadBeforeFreeze: false,
      snapshotImmutableAfterFreeze: true,
      futureLeakageAllowed: false,
    },
  };
  if (existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (existing.snapshotSha256 !== snapshotSha256) {
      throw new Error(`Pre-race manifest hash differs: ${manifestPath}`);
    }
  } else {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(templatePath, buildResultTemplate(weekData));

  console.log(JSON.stringify({
    archiveDir: "data/archive",
    snapshot: `data/archive/${date}-preodds.json`,
    manifest: `data/archive/${date}-preodds.manifest.json`,
    snapshotSha256,
    resultTemplate: `data/archive/${date}-result-template.csv`,
    races: weekData.races?.length ?? 0,
    horses: (weekData.races ?? []).reduce((sum, race) => sum + (race.horses?.length ?? 0), 0),
  }, null, 2));
};

try {
  main();
} catch (error) {
  console.error(`[archive] ${error.message}`);
  process.exit(1);
}
