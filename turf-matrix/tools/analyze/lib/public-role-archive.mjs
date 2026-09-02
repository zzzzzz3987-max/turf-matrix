import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const parseJson = (value) => JSON.parse(String(value).replace(/^\uFEFF/, ""));

export const loadFrozenPublicRoleDays = ({ root, cutoff = "13:00:00 +0900" }) => {
  const archiveDir = join(root, "data", "archive");
  const snapshotPath = "tools/week-data.json";
  const gitPrefix = execFileSync("git", ["rev-parse", "--show-prefix"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const gitSnapshotPath = `${gitPrefix}${snapshotPath}`;
  const dates = readdirSync(archiveDir)
    .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})-results\.json$/)?.[1])
    .filter(Boolean)
    .sort();
  const days = [];

  for (const date of dates) {
    const resultPath = join(archiveDir, `${date}-results.json`);
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
      results: parseJson(readFileSync(resultPath, "utf8")),
    });
  }

  return days;
};
