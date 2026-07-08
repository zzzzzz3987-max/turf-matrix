#!/usr/bin/env node
/**
 * turfmetrics 週次データ更新スクリプト
 *
 * 使い方:
 *   node update-data.mjs [week-data.json] [turfmetrics-beta.jsx]
 *   (引数省略時は同じフォルダの week-data.json / turfmetrics-beta.jsx)
 *
 * 動作:
 *   1. week-data.json を読み込み、スキーマを検証(不備があれば反映せず終了)
 *      ※検証ルールは lib-validate.mjs に集約(csv-to-week.mjs と共通)
 *   2. JSX内の WEEK_DATA:BEGIN 〜 END マーカー間を丸ごと差し替え
 *
 * Node.js 18以上。外部依存なし。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { validateWeekData } from "./lib-validate.mjs";

const [, , jsonPath = "week-data.json", jsxPath = "turfmetrics-beta.jsx"] = process.argv;

/* ---------- 1. 読み込み ---------- */
let data;
try {
  data = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch (e) {
  console.error(`✗ ${jsonPath} を読み込めません: ${e.message}`);
  process.exit(1);
}

/* ---------- 2. 検証 ---------- */
const { errors, warnings } = validateWeekData(data);
if (warnings.length) console.warn("△ 警告:\n" + warnings.map((e) => "  - " + e).join("\n"));
if (errors.length) {
  console.error("✗ 検証エラー(反映を中止しました):\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}

/* ---------- 3. 注入 ---------- */
const BEGIN = "/* ===== WEEK_DATA:BEGIN (このブロックを差し替え) ===== */";
const END = "/* ===== WEEK_DATA:END ===== */";
const jsx = readFileSync(jsxPath, "utf8");
if (!jsx.includes(BEGIN) || !jsx.includes(END)) {
  const horses = data.races.reduce((s, r) => s + r.horses.length, 0);
  console.log(`✓ 検証完了: ${data.meta.dateLabel ?? data.meta.date} / ${data.races.length}レース ${horses}頭`);
  console.log("  App.jsx は tools/week-data.json を直接読み込むため、JSXへの注入は不要です。");
  process.exit(0);
}
const head = jsx.split(BEGIN)[0];
const tail = jsx.split(END)[1];
writeFileSync(
  jsxPath,
  head + BEGIN + "\nconst WEEK_DATA = " + JSON.stringify(data, null, 2) + ";\n" + END + tail
);

const horses = data.races.reduce((s, r) => s + r.horses.length, 0);
console.log(`✓ 反映完了: ${data.meta.dateLabel ?? data.meta.date} / ${data.races.length}レース ${horses}頭`);
