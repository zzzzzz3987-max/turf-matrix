#!/usr/bin/env node
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const RUNTIME_DIR = join(TOOLS_DIR, "pad-runtime");
const STATE_PATH = join(RUNTIME_DIR, "odds-auto-update-state.json");
const LOCK_PATH = join(RUNTIME_DIR, "odds-auto-update.lock");
const LOG_PATH = join(RUNTIME_DIR, "odds-auto-update.log");
const WEEK_DATA_PATH = join(TOOLS_DIR, "week-data.json");
const CANDIDATE_PATH = join(TOOLS_DIR, "week-data.batch-candidate.json");
const NEXT_DATA_PATH = join(TOOLS_DIR, "week-data.next.json");
const BACKUP_DATA_PATH = join(TOOLS_DIR, "week-data.auto-backup.json");
const CANDIDATE_BACKUP_PATH = join(RUNTIME_DIR, "week-data.batch-candidate.backup.json");
const ALL_RACE_SIGNALS_PATH = join(TOOLS_DIR, "all-race-signals.json");
const ALL_RACE_SIGNALS_NEXT_PATH = join(RUNTIME_DIR, "all-race-signals.next.json");
const ALL_RACE_SIGNALS_BACKUP_PATH = join(RUNTIME_DIR, "all-race-signals.backup.json");
const TARGET_DIR = join(REPO_ROOT, "data", "target");
const DEFAULT_LEAD_MINUTES = 7;
const DEFAULT_POLL_SECONDS = 60;
const LOCK_MAX_AGE_MS = 18 * 60 * 60 * 1_000;

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const option = (name, fallback = null) => {
  const prefix = `${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};

const dryRun = hasFlag("--dry-run");
const watch = hasFlag("--watch");
const leadMinutes = Number(option("--lead-minutes", DEFAULT_LEAD_MINUTES));
const pollSeconds = Number(option("--poll-seconds", DEFAULT_POLL_SECONDS));
const nowOverride = option("--now");

const log = (level, message, details = null) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const line = `${new Date().toISOString()} [${level}] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`;
  console.log(line);
  appendFileSync(LOG_PATH, `${line}\n`, "utf8");
};

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const readJson = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const resolveGit = () => {
  const candidates = [
    process.env.TURF_MATRIX_GIT,
    join(process.env.USERPROFILE ?? "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "git", "cmd", "git.exe"),
    "C:\\Program Files\\Git\\cmd\\git.exe",
  ].filter(Boolean);
  return candidates.find(existsSync) ?? "git";
};

const run = (command, commandArgs, { allowFailure = false, quiet = false } = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: REPO_ROOT,
    env: { ...process.env, PATH: `${dirname(process.execPath)};${process.env.PATH ?? ""}` },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error) throw result.error;
  if (!quiet && result.stdout) appendFileSync(LOG_PATH, result.stdout, "utf8");
  if (!quiet && result.stderr) appendFileSync(LOG_PATH, result.stderr, "utf8");
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result;
};

const runNode = (...nodeArgs) => run(process.execPath, nodeArgs);
const runNodeWithEnv = (extraEnv, ...nodeArgs) => {
  const previous = {};
  for (const [key, value] of Object.entries(extraEnv)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return runNode(...nodeArgs);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
};
const runPowerShell = (...scriptArgs) => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...scriptArgs]);

const parseSchedule = (weekData, allRaceSignals = null) => {
  const raceDate = weekData.meta?.date ?? weekData.races?.[0]?.id?.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Race date is missing from week-data.json");
  const signalRaces = allRaceSignals?.date === raceDate ? allRaceSignals.races ?? [] : [];
  const scheduleRaces = signalRaces.length ? signalRaces : weekData.races ?? [];
  return scheduleRaces.map((race) => {
    if (!/^\d{1,2}:\d{2}$/.test(race.time ?? "")) throw new Error(`${race.id}: race time is missing`);
    const postTime = new Date(`${raceDate}T${race.time}:00+09:00`);
    return {
      id: race.id,
      track: race.track,
      number: race.number,
      name: race.name,
      time: race.time,
      postTime,
      triggerTime: new Date(postTime.getTime() - leadMinutes * 60_000),
    };
  }).sort((left, right) => left.postTime - right.postTime);
};

const snapshotSchedule = (schedule, now, state) => schedule.map((race) => ({
  id: race.id,
  race: `${race.track}${race.number}R ${race.name}`,
  postTime: race.postTime.toISOString(),
  triggerTime: race.triggerTime.toISOString(),
  processed: state.processed?.[race.id]?.status === "published",
  due: now >= race.triggerTime && now < race.postTime && state.processed?.[race.id]?.status !== "published",
}));

const latestOddsCandidate = (notBefore) => {
  const candidates = readdirSync(TARGET_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name === "odds.csv" || /^odds\.next-\d{8}-\d{6}\.csv$/.test(entry.name)))
    .map((entry) => join(TARGET_DIR, entry.name))
    .filter((path) => statSync(path).mtimeMs >= notBefore - 2_000)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (!candidates.length) throw new Error("JV-Link did not produce a new odds CSV");
  return candidates[0];
};

const assertCleanTrackedTree = (git) => {
  const result = run(git, ["status", "--porcelain", "--untracked-files=no"], { quiet: true });
  if (result.stdout.trim()) throw new Error(`Tracked changes exist before automatic publish:\n${result.stdout.trim()}`);
  const branch = run(git, ["branch", "--show-current"], { quiet: true }).stdout.trim();
  if (branch !== "main") throw new Error(`Automatic publish requires main branch, current=${branch || "detached"}`);
  const ahead = Number(run(git, ["rev-list", "--count", "origin/main..HEAD"], { quiet: true }).stdout.trim());
  const behind = Number(run(git, ["rev-list", "--count", "HEAD..origin/main"], { quiet: true }).stdout.trim());
  if (ahead || behind) throw new Error(`main must match origin/main before automatic publish (ahead=${ahead}, behind=${behind})`);
};

const generateAndPublish = (git, commitMessage) => {
  const candidateExisted = existsSync(CANDIDATE_PATH);
  if (candidateExisted) copyFileSync(CANDIDATE_PATH, CANDIDATE_BACKUP_PATH);
  if (existsSync(ALL_RACE_SIGNALS_PATH)) copyFileSync(ALL_RACE_SIGNALS_PATH, ALL_RACE_SIGNALS_BACKUP_PATH);
  runNodeWithEnv(
    { TURF_MATRIX_ALL_RACE_SIGNALS_OUT: ALL_RACE_SIGNALS_NEXT_PATH },
    "tools/generate-all-race-signals.mjs",
  );
  copyFileSync(ALL_RACE_SIGNALS_NEXT_PATH, ALL_RACE_SIGNALS_PATH);
  runNode("tools/normalizers/race-batch.mjs");
  runNode("tools/generate-race-batch-candidate.mjs");
  runNode("tools/prepare-race-batch-release.mjs");

  copyFileSync(WEEK_DATA_PATH, BACKUP_DATA_PATH);
  copyFileSync(NEXT_DATA_PATH, WEEK_DATA_PATH);
  let committed = false;
  try {
    const tests = readdirSync(join(TOOLS_DIR, "intelligence", "tests"))
      .filter((name) => name.endsWith(".test.mjs"))
      .map((name) => join("tools", "intelligence", "tests", name));
    runNode("--test", ...tests);
    runNode("tools/verify-data-integrity.mjs");
    runNode("node_modules/vite/bin/vite.js", "build");
    run(git, ["diff", "--check"]);
    try {
      runNode("tools/archive-race-release.mjs");
    } catch (error) {
      log("WARN", "Release archive failed; publish continues", { error: error.message });
    }

    const publishPaths = ["tools/week-data.json", "tools/week-data.batch-candidate.json", "tools/all-race-signals.json"];
    const diff = run(git, ["diff", "--quiet", "--", ...publishPaths], { allowFailure: true, quiet: true });
    if (diff.status === 0) return { changed: false, commit: null };
    run(git, ["add", ...publishPaths]);
    run(git, ["commit", "-m", commitMessage]);
    committed = true;
    const commit = run(git, ["rev-parse", "HEAD"], { quiet: true }).stdout.trim();
    run(git, ["push", "origin", "main"]);
    return { changed: true, commit };
  } catch (error) {
    if (!committed && existsSync(BACKUP_DATA_PATH)) copyFileSync(BACKUP_DATA_PATH, WEEK_DATA_PATH);
    throw error;
  } finally {
    if (existsSync(NEXT_DATA_PATH)) rmSync(NEXT_DATA_PATH, { force: true });
    if (existsSync(BACKUP_DATA_PATH)) rmSync(BACKUP_DATA_PATH, { force: true });
    if (!committed && candidateExisted && existsSync(CANDIDATE_BACKUP_PATH)) {
      copyFileSync(CANDIDATE_BACKUP_PATH, CANDIDATE_PATH);
    } else if (!committed && !candidateExisted && existsSync(CANDIDATE_PATH)) {
      rmSync(CANDIDATE_PATH, { force: true });
    }
    if (!committed && existsSync(ALL_RACE_SIGNALS_BACKUP_PATH)) {
      copyFileSync(ALL_RACE_SIGNALS_BACKUP_PATH, ALL_RACE_SIGNALS_PATH);
    }
    if (existsSync(CANDIDATE_BACKUP_PATH)) rmSync(CANDIDATE_BACKUP_PATH, { force: true });
    if (existsSync(ALL_RACE_SIGNALS_NEXT_PATH)) rmSync(ALL_RACE_SIGNALS_NEXT_PATH, { force: true });
    if (existsSync(ALL_RACE_SIGNALS_BACKUP_PATH)) rmSync(ALL_RACE_SIGNALS_BACKUP_PATH, { force: true });
  }
};

const processDueRaces = (due, state) => {
  const git = resolveGit();
  assertCleanTrackedTree(git);
  const startedAt = Date.now();

  runPowerShell("-File", "tools/jvfetch/capture-odds.ps1");
  const oddsPath = latestOddsCandidate(startedAt);
  runNode("tools/jvfetch/distribute-odds.mjs", oddsPath);

  try {
    runPowerShell("-File", "tools/jvfetch/run-jvfetch.ps1", "--conditions-only");
    runNode("tools/jvlink/extract-race-conditions.mjs");
  } catch (error) {
    log("WARN", "Condition refresh failed; verified odds update continues", { error: error.message });
  }

  const labels = due.map((race) => `${race.track}${race.number}R`).join("/");
  const result = generateAndPublish(git, `Update live odds before ${labels}`);
  const completedAt = new Date().toISOString();
  for (const race of due) {
    state.processed[race.id] = {
      status: "published",
      triggerTime: race.triggerTime.toISOString(),
      completedAt,
      oddsFile: oddsPath.slice(REPO_ROOT.length + 1).replaceAll("\\", "/"),
      commit: result.commit,
      changed: result.changed,
    };
  }
  writeJson(STATE_PATH, state);
  log("INFO", "Automatic odds update completed", { races: labels, ...result });
};

const runOnce = () => {
  if (!existsSync(WEEK_DATA_PATH)) throw new Error(`week-data.json was not found: ${WEEK_DATA_PATH}`);
  const weekData = readJson(WEEK_DATA_PATH, null);
  const allRaceSignals = readJson(ALL_RACE_SIGNALS_PATH, null);
  const schedule = parseSchedule(weekData, allRaceSignals);
  const raceDate = weekData.meta?.date ?? schedule[0]?.id?.slice(0, 10);
  const now = nowOverride ? new Date(nowOverride) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now value: ${nowOverride}`);

  const stored = readJson(STATE_PATH, { raceDate, processed: {} });
  const state = stored.raceDate === raceDate ? stored : { raceDate, processed: {} };
  const report = snapshotSchedule(schedule, now, state);
  const dueIds = new Set(report.filter((race) => race.due).map((race) => race.id));
  const due = schedule.filter((race) => dueIds.has(race.id));

  if (dryRun) {
    console.log(JSON.stringify({ status: "dry-run", now: now.toISOString(), leadMinutes, raceDate, schedule: report }, null, 2));
    return { done: false, latestPostTime: schedule.at(-1)?.postTime };
  }
  if (!due.length) {
    log("INFO", "No race is due for an odds update", { now: now.toISOString(), next: report.find((race) => !race.processed && new Date(race.triggerTime) > now)?.race ?? null });
  } else {
    processDueRaces(due, state);
  }
  return { done: now > new Date((schedule.at(-1)?.postTime?.getTime() ?? 0) + 5 * 60_000), latestPostTime: schedule.at(-1)?.postTime };
};

const main = async () => {
  if (!Number.isFinite(leadMinutes) || leadMinutes < 3 || leadMinutes > 15) throw new Error("--lead-minutes must be between 3 and 15");
  if (!Number.isFinite(pollSeconds) || pollSeconds < 30) throw new Error("--poll-seconds must be at least 30");
  mkdirSync(RUNTIME_DIR, { recursive: true });

  let lockHandle;
  const acquireLock = () => {
    try {
      const handle = openSync(LOCK_PATH, "wx");
      writeFileSync(handle, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
      return handle;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let active = false;
      try {
        const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
        const startedAt = new Date(lock.startedAt).getTime();
        const lockIsCurrent = Number.isFinite(startedAt) && Date.now() - startedAt <= LOCK_MAX_AGE_MS;
        if (lockIsCurrent) {
          process.kill(Number(lock.pid), 0);
          active = true;
        }
      } catch {
        active = false;
      }
      if (active) return null;
      rmSync(LOCK_PATH, { force: true });
      return acquireLock();
    }
  };
  lockHandle = acquireLock();
  if (lockHandle == null) {
    log("WARN", "Another automatic odds updater is already running");
    return;
  }

  try {
    do {
      const result = runOnce();
      if (!watch || dryRun || result.done) break;
      await sleep(pollSeconds * 1_000);
    } while (true);
  } finally {
    if (lockHandle != null) closeSync(lockHandle);
    if (existsSync(LOCK_PATH)) rmSync(LOCK_PATH, { force: true });
  }
};

main().catch((error) => {
  log("ERROR", error.message, { stack: error.stack });
  process.exit(1);
});
