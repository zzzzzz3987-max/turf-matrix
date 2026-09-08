import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildEngineFingerprint } from "../../intelligence/engine-fingerprint.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const save = (path, value, exclusive = false) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: exclusive ? "wx" : "w" });
};

export const preserveFrozenArtifact = (path, artifact, validateArtifact) => {
  validateArtifact(artifact);
  if (existsSync(path)) {
    const previous = read(path);
    validateArtifact(previous);
    if (previous.inputSha256 !== artifact.inputSha256 || previous.modelSha256 !== artifact.modelSha256) {
      throw new Error("Frozen comparison differs; existing record preserved");
    }
    return previous;
  }
  save(path, artifact, true);
  return artifact;
};

export const runFactorShadowCli = ({ name, directory, factor, buildArtifact, validateArtifact, evaluateArtifact, renderReport }) => {
  const { values } = parseArgs({ options: {
    input: { type: "string", default: "tools/week-data.json" },
    freeze: { type: "boolean", default: false },
    evaluate: { type: "string" }, results: { type: "string" },
  } });
  if (values.evaluate) {
    if (values.freeze || !values.results) throw new Error("Evaluation requires --results and cannot freeze");
    const artifact = read(resolve(root, values.evaluate));
    // Check the fixed record before reading any race result.
    validateArtifact(artifact);
    const result = evaluateArtifact(artifact, read(resolve(root, values.results)));
    const output = resolve(root, `docs/analysis/${name}-evaluation-${artifact.raceDate}.json`);
    save(output, { ...result, predictionSha256: artifact.predictionSha256 });
    console.log(JSON.stringify({ output, ...result.summary, skipped: result.skipped }, null, 2));
    return;
  }
  if (values.results) throw new Error("--results is only valid with --evaluate");
  const week = read(resolve(root, values.input));
  const modelSha256 = buildEngineFingerprint({ root, entryPoints: [`tools/analyze/lib/${name}-shadow.mjs`] }).sha256;
  let artifact = buildArtifact(week, { prospective: values.freeze, modelSha256 });
  if (values.freeze) {
    const output = resolve(root, `data/shadow/${directory}/${artifact.raceDate}-pre-race.json`);
    artifact = preserveFrozenArtifact(output, artifact, validateArtifact);
  }
  const kind = values.freeze ? "shadow" : "diagnostic";
  const base = resolve(root, `docs/analysis/${name}-${kind}-${artifact.raceDate}`);
  save(base + ".json", artifact);
  writeFileSync(base + ".md", renderReport(artifact));
  const horses = artifact.predictions.flatMap((race) => race.horses);
  console.log(JSON.stringify({ report: base + ".md", status: artifact.status, races: artifact.predictions.length,
    [factor + "Changed"]: horses.filter((horse) => horse[factor + "Delta"] !== 0).length,
    tmChanged: horses.filter((horse) => horse.tmDelta !== 0).length,
    leadersChanged: artifact.predictions.filter((race) => race.leaderChanged).length,
  }, null, 2));
};
