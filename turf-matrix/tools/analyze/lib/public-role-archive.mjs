import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const parseJson = (value) => JSON.parse(String(value).replace(/^\uFEFF/, ""));

const courseSlugs = { '01': 'sapporo', '02': 'hakodate', '03': 'fukushima', '04': 'niigata',
  '05': 'tokyo', '06': 'nakayama', '07': 'chukyo', '08': 'kyoto', '09': 'hanshin', '10': 'kokura' };

export const normalizePublicRoleResults = (results, date) => {
  if (Array.isArray(results?.races)) return results;
  if (results?.RaceDate !== date || !Array.isArray(results.Races) || !results.Races.length) {
    throw new Error(`Invalid result archive: ${date}`);
  }
  const seen = new Set();
  const races = results.Races.map(result => {
    const slug = courseSlugs[String(result.Race?.CourseCode).padStart(2, '0')];
    const number = result.Race?.RaceNo;
    if (!slug || !Number.isInteger(number) || number < 1 || number > 12 ||
        result.IsFinal !== true || result.HasPayouts !== true ||
        !Array.isArray(result.Horses) || !Array.isArray(result.Payouts)) {
      throw new Error(`Unverified race result: ${date}/${number}`);
    }
    const bundleId = `${date}-${slug}-${String(number).padStart(2, '0')}R`;
    if (seen.has(bundleId)) throw new Error(`Duplicate result race: ${bundleId}`);
    seen.add(bundleId);
    const horseNumbers = new Set();
    const horses = result.Horses.map(horse => {
      if (!Number.isInteger(horse.HorseNumber) || horse.HorseNumber < 1 || horseNumbers.has(horse.HorseNumber)) {
        throw new Error(`Invalid horse identity: ${bundleId}`);
      }
      horseNumbers.add(horse.HorseNumber);
      const payout = type => {
        const entry = result.Payouts.find(p => p.Type === type && p.HorseNumber === horse.HorseNumber);
        if (entry && (!Number.isFinite(entry.Payout) || entry.Payout < 0)) throw new Error(`Invalid payout: ${bundleId}`);
        return entry?.Payout ?? 0;
      };
      return { horseNumber: horse.HorseNumber, horseName: horse.HorseName,
        finishPosition: horse.FinishPosition, abnormalityCode: horse.AbnormalityCode,
        popularity: horse.FinalPopularity, winPayout: payout('win'), placePayout: payout('place') };
    });
    return { bundleId, horses };
  });
  return { date, races };
};

export const loadFrozenPublicRoleDays = ({ root, cutoff = "13:00:00 +0900" }) => {
  const archiveDir = join(root, "data", "archive");
  const snapshotPath = "tools/week-data.json";
  const gitPrefix = execFileSync("git", ["rev-parse", "--show-prefix"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const gitSnapshotPath = `${gitPrefix}${snapshotPath}`;
  const dates = readdirSync(archiveDir)
    .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})-(?:all-race-)?results\.json$/)?.[1])
    .filter(Boolean)
    .sort();
  const days = [];

  for (const date of [...new Set(dates)]) {
    const legacyPath = join(archiveDir, `${date}-results.json`);
    const resultPath = existsSync(legacyPath) ? legacyPath : join(archiveDir, `${date}-all-race-results.json`);
    if (!existsSync(resultPath)) continue;
    const commit = execFileSync("git", [
      "rev-list", "-1", `--before=${date} ${cutoff}`, "HEAD", "--", snapshotPath,
    ], { cwd: root, encoding: "utf8" }).trim();
    if (!commit) continue;
    const snapshot = parseJson(execFileSync("git", ["show", `${commit}:${gitSnapshotPath}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }));
    const snapshotDate = snapshot.meta?.date ?? snapshot.races?.[0]?.id?.slice(0, 10);
    if (snapshotDate !== date) continue;
    days.push({
      date,
      commit,
      snapshot,
      results: normalizePublicRoleResults(parseJson(readFileSync(resultPath, "utf8")), date),
    });
  }

  return days;
};
