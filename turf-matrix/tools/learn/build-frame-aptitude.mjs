#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrameAptitudeModel } from "./frame-aptitude-learning.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = join(ROOT, "data", "master", "race-shape-history.json");
const OUTPUT = join(ROOT, "data", "master", "frame-aptitude.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const sourceBytes = readFileSync(SOURCE);
const model = buildFrameAptitudeModel(readJson(SOURCE));
const artifact = {
  ...model,
  generatedAt: new Date().toISOString(),
  sourceFile: relative(ROOT, SOURCE).replaceAll("\\", "/"),
  sourceSha256: sha256(sourceBytes),
};

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: OUTPUT, status: artifact.status, ...artifact.summary, validation: artifact.validation }, null, 2));
