#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TOOLS_DIR, "..");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");
const OUT_DIR = join(TOOLS_DIR, "pad-runtime");
const OUT_JSON = join(OUT_DIR, "race-batch-manifest.json");
const OUT_MD = join(OUT_DIR, "race-batch-manifest.md");

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const abs = (...parts) => join(REPO_ROOT, ...parts);

const bundles = config.bundles.map((bundleId, index) => ({
  order: index + 1,
  bundleId,
  csvFolder: abs("tools", "csv", "input", "races", bundleId),
  htmlFolder: abs("tools", "target-html", "input", "races", bundleId),
  files: {
    currentRace: abs("tools", "csv", "input", "races", bundleId, "current-race-detail.csv"),
    all: abs("tools", "csv", "input", "races", bundleId, "all.csv"),
    odds: abs("tools", "csv", "input", "races", bundleId, "odds.csv"),
    trainingSlope: abs("tools", "target-html", "input", "races", bundleId, "training-slope.html"),
    trainingWood: abs("tools", "target-html", "input", "races", bundleId, "training-wood.html"),
    pedigreeFolder: abs("tools", "target-html", "input", "races", bundleId, "pedigree"),
  },
}));

const manifest = {
  schemaVersion: 1,
  raceDate: config.raceDate,
  expectedRaceCount: config.expectedRaceCount,
  repoRoot: REPO_ROOT,
  padFlow: {
    thursday: [
      "TARGETを更新",
      "対象レースを開く",
      "current-race-detail.csv を保存",
      "all.csv を保存",
      "任意で training-slope.html / training-wood.html / pedigree HTML を保存",
      "npm run inspect:race-batch",
      "npm run thursday:preview",
    ],
    saturday: [
      "TARGETを更新",
      "各レースの odds.csv を保存",
      "npm run inspect:race-batch",
      "npm run saturday:publish",
    ],
  },
  bundles,
};

const md = [
  `# PAD race batch manifest`,
  ``,
  `Race date: ${config.raceDate}`,
  `Expected races: ${config.expectedRaceCount}`,
  ``,
  `Use this file as the fixed save list when recording Power Automate Desktop.`,
  `Raw TARGET files are saved into the paths below and are ignored by git.`,
  ``,
  `## Thursday pre-odds`,
  ``,
  `For each bundle, save:`,
  ``,
  `- current race detail CSV -> current-race-detail.csv`,
  `- TARGET all export -> all.csv`,
  `- optional slope training HTML -> training-slope.html`,
  `- optional wood/CW/D training HTML -> training-wood.html`,
  `- optional horse pedigree HTML -> pedigree folder`,
  ``,
  `## Saturday odds`,
  ``,
  `For each bundle, save TARGET odds CSV -> odds.csv`,
  ``,
  `## Bundles`,
  ``,
  ...bundles.flatMap((bundle) => [
    `### ${bundle.order}. ${bundle.bundleId}`,
    ``,
    `CSV folder: \`${bundle.csvFolder}\``,
    ``,
    `- currentRace: \`${bundle.files.currentRace}\``,
    `- all: \`${bundle.files.all}\``,
    `- odds: \`${bundle.files.odds}\``,
    ``,
    `HTML folder: \`${bundle.htmlFolder}\``,
    ``,
    `- trainingSlope: \`${bundle.files.trainingSlope}\``,
    `- trainingWood: \`${bundle.files.trainingWood}\``,
    `- pedigreeFolder: \`${bundle.files.pedigreeFolder}\``,
    ``,
  ]),
].join("\n");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(OUT_MD, md + "\n");
console.log(JSON.stringify({ outJson: OUT_JSON, outMarkdown: OUT_MD, raceDate: config.raceDate, bundles: bundles.length }, null, 2));
