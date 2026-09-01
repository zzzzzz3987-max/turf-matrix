import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parse, parsePedigreeHtml } from "../../parsers/pedigree-html-parser.mjs";

const jbisCard = (name, index) => `
  <div class="data-3__${index % 2 ? "female" : "male"}">
    <a href="/horse/${String(index + 1).padStart(10, "0")}/" class="txt-male txt-link">${name}</a>
  </div>`;

test("JBIS five-generation cards map all 62 ancestors to deterministic branches", () => {
  const names = Array.from({ length: 62 }, (_, index) => `ancestor-${index}`);
  names[0] = "ハービンジャー(GB)";
  names[1] = "Dansili(GB)";
  names[2] = "Penang Pearl(FR)";
  names[31] = "チェッキーノ";
  names[32] = "キングカメハメハ";
  names[33] = "ハッピーパス";
  const html = `<a href="https://www.jbis.jp/horse/0001337947/pedigree/">English</a>
    <div class="data-3__items">${names.map(jbisCard).join("")}</div>`;

  const parsed = parsePedigreeHtml(html);
  const byBranch = new Map(parsed.ancestors.map((ancestor) => [ancestor.branch, ancestor]));

  assert.equal(parsed.format, "jbis-five-generation");
  assert.equal(parsed.sourceSystem, "JBIS-Search");
  assert.equal(parsed.sourceUrl, "https://www.jbis.or.jp/horse/0001337947/pedigree/");
  assert.equal(parsed.cellCount, 62);
  assert.equal(parsed.ancestors.length, 62);
  assert.equal(byBranch.get("sire").name, "ハービンジャー");
  assert.equal(byBranch.get("sire.sire").name, "Dansili");
  assert.equal(byBranch.get("sire.dam").name, "Penang Pearl");
  assert.equal(byBranch.get("dam").name, "チェッキーノ");
  assert.equal(byBranch.get("dam.sire").name, "キングカメハメハ");
  assert.equal(byBranch.get("dam.dam").name, "ハッピーパス");
  assert.equal(parsed.ancestors.filter((ancestor) => ancestor.generation === 5).length, 32);
});

test("legacy TARGET tables retain the existing four-generation branch map", () => {
  const cells = Array.from({ length: 30 }, (_, index) => `<td>target-${index}</td>`).join("");
  const parsed = parsePedigreeHtml(`<table><tr>${cells}</tr></table>`);
  const byBranch = new Map(parsed.ancestors.map((ancestor) => [ancestor.branch, ancestor.name]));

  assert.equal(parsed.format, "target-table");
  assert.equal(parsed.sourceSystem, "TARGET frontier JV");
  assert.equal(parsed.ancestors.length, 30);
  assert.equal(byBranch.get("sire"), "target-0");
  assert.equal(byBranch.get("sire.sire.sire"), "target-2");
  assert.equal(byBranch.get("dam"), "target-15");
  assert.equal(byBranch.get("dam.dam.dam.dam"), "target-29");
});

test("tracked JSON cache works when raw HTML is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "turf-matrix-pedigree-"));
  const cachePath = join(root, "cache");
  mkdirSync(cachePath);
  writeFileSync(join(cachePath, "テストホース.json"), JSON.stringify({
    horseName: "テストホース",
    sire: "テスト父",
    dam: "テスト母",
    broodmareSire: "テスト母父",
    ancestors: [{ generation: 1, branch: "sire", name: "テスト父" }],
    source: { sourceSystem: "JBIS-Search" },
  }));

  try {
    const result = parse({ path: join(root, "missing-html"), cachePath });
    assert.equal(result.recordCount, 1);
    assert.equal(result.records[0].horseName, "テストホース");
    assert.equal(result.records[0].source.sourceSystem, "JBIS-Search");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a matching five-generation cache fills branches missing from TARGET HTML", () => {
  const root = mkdtempSync(join(tmpdir(), "turf-matrix-pedigree-"));
  const htmlPath = join(root, "html");
  const cachePath = join(root, "cache");
  mkdirSync(htmlPath);
  mkdirSync(cachePath);
  const cells = Array.from({ length: 30 }, (_, index) => `<td>target-${index}</td>`).join("");
  const html = `<table><tr>${cells}</tr></table>`;
  const parsed = parsePedigreeHtml(html);
  const cachedAncestors = [
    ...parsed.ancestors,
    { generation: 5, branch: "dam.dam.dam.dam.sire", name: "deep-cache-ancestor" },
  ];
  writeFileSync(join(htmlPath, "テストホース.html"), html);
  writeFileSync(join(cachePath, "テストホース.json"), JSON.stringify({
    horseName: "テストホース",
    sire: "target-0",
    dam: "target-15",
    broodmareSire: "target-16",
    ancestors: cachedAncestors,
    source: { sourceSystem: "JV-Link", cellCount: cachedAncestors.length },
  }));

  try {
    const result = parse({ path: htmlPath, cachePath });
    const record = result.records[0];
    assert.equal(record.source.format, "target-table");
    assert.equal(record.source.supplementedBy, "JV-Link");
    assert.equal(record.ancestors.length, 31);
    assert.equal(record.ancestors.at(-1).name, "deep-cache-ancestor");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
