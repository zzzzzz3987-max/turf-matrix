#!/usr/bin/env node
/**
 * csv-to-week.mjs — TARGET frontier JV CSV → week-data.json 変換パイプライン
 *
 * 使い方:
 *   node csv-to-week.mjs --config csv-config.json
 *   オプション:
 *     --config  <path>  入力CSVの構成ファイル (既定: csv-config.json)
 *     --mapping <path>  列名マッピング       (既定: target-mapping.json)
 *     --out     <path>  出力JSON             (既定: week-data.json)
 *     --log     <path>  変換ログ             (既定: conversion-log.txt)
 *     --force           検証エラーがあっても出力する(ドラフト用途)
 *
 * 特徴:
 *   - 出馬表/前走/血統/調教/オッズの「別CSV」も「統合CSV」も取り込み可能
 *   - 文字コード自動判別(UTF-8 / Shift_JIS(CP932))
 *   - 列名の揺れは target-mapping.json のエイリアス追加で吸収(コード変更不要)
 *   - 数値スコアは決定的ロジックで算出(AI不使用・毎週同じ結果)
 *   - 文章はテンプレートで自動生成 → そのまま公開可能な「縮退運転」品質。
 *     任意のLLM(Claude等)で磨く場合は同時出力される llm-enrich-prompt.txt を使う
 *   - Node.js 18+ / 外部依存なし / 特定AIワークフローに非依存
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWeekData } from "./lib-validate.mjs";

/* =====================================================================
 * 0. CLI / ログ
 * ===================================================================== */
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--force") args.force = true;
  else if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
}
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = args.config ?? "csv-config.json";
/* マッピングは カレント → スクリプトと同じフォルダ の順で探す */
const MAPPING_PATH = args.mapping ?? (existsSync("target-mapping.json") ? "target-mapping.json" : join(SCRIPT_DIR, "target-mapping.json"));
const OUT_PATH = args.out ?? "week-data.json";
const LOG_PATH = args.log ?? "conversion-log.txt";

const LOG = [];
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (level, msg) => {
  LOG.push(`[${level}] ${msg}`);
  const prefix = level === "ERROR" ? "✗" : level === "WARN" ? "△" : "・";
  (level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log)(`${prefix} ${msg}`);
};
const err = (m) => log("ERROR", m);
const warn = (m) => log("WARN", m);
const info = (m) => log("INFO", m);
const flushLog = () => {
  const head = `turfmetrics CSV変換ログ  ${stamp()}\n設定: ${CONFIG_PATH} / マッピング: ${MAPPING_PATH}\n${"=".repeat(60)}\n`;
  writeFileSync(LOG_PATH, head + LOG.join("\n") + "\n");
};
const die = (m) => { err(m); flushLog(); process.exit(1); };

/* =====================================================================
 * 1. 文字列・数値の正規化ユーティリティ
 * ===================================================================== */
/** 全角英数記号→半角、全角スペース→半角 */
const z2h = (s) =>
  String(s ?? "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
const normHeader = (s) => z2h(s).replace(/^\uFEFF/, "").replace(/\s+/g, "").trim();
const normCell = (s) => z2h(s).trim();
const toNum = (s) => {
  if (s == null || s === "") return null;
  const n = parseFloat(z2h(String(s)).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo = 42, hi = 97) => Math.max(lo, Math.min(hi, Math.round(v)));
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const jit = (seed, n, range = 3) => (hash(seed + ":" + n) % (range * 2 + 1)) - range;
const pad2 = (n) => String(n).padStart(2, "0");

/** 日付の柔軟パース → Date | null */
const parseDate = (s) => {
  if (!s) return null;
  const t = z2h(String(s)).trim();
  let m = t.match(/^(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})[\/月](\d{1,2})/);
  if (m) return new Date(new Date().getFullYear(), +m[1] - 1, +m[2]);
  return null;
};
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const jaLabel = (d) => `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${pad2(Math.ceil(((t - y0) / 864e5 + 1) / 7))}`;
};

/** 着差 → 秒相当の数値(テキスト表記対応) */
const parseMargin = (s) => {
  if (s == null || s === "") return 0;
  const t = z2h(String(s)).trim();
  const n = parseFloat(t);
  if (Number.isFinite(n) && /^[\d.]+$/.test(t)) return n;
  const table = { ハナ: 0.05, アタマ: 0.1, クビ: 0.15, 同着: 0, 大差: 2.0 };
  for (const k of Object.keys(table)) if (t.includes(k)) return table[k];
  const m = t.match(/([\d.]+)\s*馬身/);
  if (m) return parseFloat(m[1]) * 0.17; // 1馬身≒0.17秒
  return 0.3;
};

/** 脚質の正規化 */
const normStyle = (s) => {
  const t = z2h(String(s ?? "")).trim();
  if (t.startsWith("逃")) return "逃げ";
  if (t.startsWith("先")) return "先行";
  if (t.startsWith("差")) return "差し";
  if (t.startsWith("追")) return "追込";
  return null;
};

const TRACK_ID = {
  東京: "tokyo", 中山: "nakayama", 阪神: "hanshin", 京都: "kyoto", 中京: "chukyo",
  新潟: "niigata", 福島: "fukushima", 小倉: "kokura", 札幌: "sapporo", 函館: "hakodate",
};
const trackId = (t) => TRACK_ID[t] ?? "race" + (hash(t) % 100);

const normGrade = (s) => {
  const t = z2h(String(s ?? "")).replace(/\s/g, "");
  if (/G[Ⅰ1I]|GI(?![IV])/i.test(t) && !/G[Ⅱ2]|GII/i.test(t) && !/G[Ⅲ3]|GIII/i.test(t)) return "GⅠ";
  if (/G[Ⅱ2]|GII(?!I)/i.test(t)) return "GⅡ";
  if (/G[Ⅲ3]|GIII/i.test(t)) return "GⅢ";
  return null;
};
const raceCategory = (race) => {
  if (race?.category) return race.category;
  if (race?.grade || normGrade(race?.name)) return "grade";
  if (/特別|ステークス|S$|賞|記念/.test(String(race?.name ?? ""))) return "special";
  return "race";
};


/* =====================================================================
 * 2. CSV読み込み(文字コード自動判別) & パース
 * ===================================================================== */
const readCsvSmart = (path) => {
  const buf = readFileSync(path);
  // UTF-8 BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString("utf8");
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8; // UTF-8として破綻なし
  try {
    return new TextDecoder("shift_jis").decode(buf); // TARGET既定のShift_JIS(CP932)
  } catch {
    die(`${path}: Shift_JISデコードに失敗しました(Node.jsのICUが不足)。CSVをUTF-8で書き出し直してください`);
  }
};

/** RFC4180準拠の簡易CSVパーサ(引用符・引用符内カンマ/改行対応) */
const parseCsv = (text) => {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
};

/* 行頭が # の行はコメントとして無視(supplement-template.csv の説明行など) */
const stripCommentRows = (rows) => rows.filter((r) => !String(r[0] ?? "").trim().startsWith("#"));

/* =====================================================================
 * 3. 列マッピング解決
 * ===================================================================== */
let MAPPING, PROFILES;
try {
  const parsed = JSON.parse(readFileSync(MAPPING_PATH, "utf8"));
  MAPPING = parsed.columns;
  PROFILES = parsed.profiles ?? {};
} catch (e) {
  die(`マッピングファイル ${MAPPING_PATH} を読み込めません: ${e.message}`);
}

/** headers → { 内部フィールド名: 列index } */
const resolveColumns = (headers, fileLabel) => {
  const normed = headers.map(normHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(MAPPING)) {
    for (const alias of aliases) {
      const idx = normed.indexOf(normHeader(alias));
      if (idx >= 0) { map[field] = idx; break; }
    }
  }
  const unmapped = headers.filter((_, i) => !Object.values(map).includes(i));
  if (unmapped.length)
    info(`${fileLabel}: 未対応の列を無視しました → ${unmapped.map(normHeader).join(", ")}`);
  return map;
};

/** 1ファイルを {field: 値} の配列に変換 */
const loadFile = (path, kind) => {
  if (!existsSync(path)) die(`CSVが見つかりません: ${path} (kind: ${kind})`);
  const rows = stripCommentRows(parseCsv(readCsvSmart(path)));
  if (rows.length < 2) die(`${path}: データ行がありません`);
  const cols = resolveColumns(rows[0], path);
  const records = rows.slice(1).map((r) => {
    const rec = {};
    for (const [field, idx] of Object.entries(cols)) rec[field] = normCell(r[idx] ?? "");
    return rec;
  });
  info(`${path}: ${records.length}行 読み込み(kind: ${kind}, 認識列: ${Object.keys(cols).length})`);
  return records;
};

/* ---- ヘッダー無し・特定CSV形式(プロファイル定義による位置指定パース) ---- */
const TRACK_BY_CODE = { 1: "札幌", 2: "函館", 3: "福島", 4: "新潟", 5: "東京", 6: "中山", 7: "中京", 8: "京都", 9: "阪神", 10: "小倉" };

const loadProfileFile = (path, kind, profileName) => {
  const prof = PROFILES[profileName];
  if (!prof) die(`profile "${profileName}" が ${MAPPING_PATH} の profiles に定義されていません`);
  if (!existsSync(path)) die(`CSVが見つかりません: ${path} (kind: ${kind})`);
  const rows = stripCommentRows(parseCsv(readCsvSmart(path)));
  const out = [];
  for (const [ri, r] of rows.entries()) {
    if (r.length < (prof.minColumns ?? 1)) { warn(`${path} ${ri + 1}行目: 列数不足(${r.length})のためスキップ`); continue; }
    const keyRaw = z2h(r[prof.key.index]).trim();
    if (!/^\d{10}$/.test(keyRaw)) { warn(`${path} ${ri + 1}行目: キー"${keyRaw}"が10桁数値でないためスキップ`); continue; }
    const rec = {};
    const tCode = +keyRaw.slice(prof.key.trackDigits[0], prof.key.trackDigits[1]);
    rec.track = TRACK_BY_CODE[tCode] ?? `場${tCode}`;
    rec.raceNo = String(+keyRaw.slice(prof.key.raceNoDigits[0], prof.key.raceNoDigits[1]));
    rec.horseNo = String(+keyRaw.slice(prof.key.horseNoDigits[0], prof.key.horseNoDigits[1]));
    for (const [idx, field] of Object.entries(prof.fields)) rec[field] = normCell(r[+idx] ?? "");
    if (rec.surfaceCode != null) rec.surface = rec.surfaceCode === "1" ? "ダ" : "芝";
    const g = prof.pastRuns;
    if (g) {
      rec.pastRuns = [];
      for (let j = 0; j < g.count; j++) {
        const seg = r.slice(g.start + j * g.size, g.start + (j + 1) * g.size).map(normCell);
        const run = {};
        g.fields.forEach((f2, k) => { run[f2] = seg[k]; });
        if (toNum(run.courseCode) && toNum(run.distance)) {
          run.margin = run.marginTenths != null && run.marginTenths !== "" ? (toNum(run.marginTenths) ?? 0) / 10 : null;
          run.surface = run.surfaceCode === "1" ? "ダ" : "芝";
          rec.pastRuns.push(run);
        }
      }
      const z = rec.pastRuns[0]; // 左端=前走(新→古)の前提
      if (z) {
        rec.zensoDistance = z.distance;
        rec.zensoSurface = z.surface;
        rec.zensoMargin = z.margin != null ? String(z.margin) : "";
        rec.zensoCourseCode = z.courseCode;
      }
    }
    out.push(rec);
  }
  info(`${path}: ${out.length}頭 読み込み(profile: ${profileName} / kind: ${kind})`);
  return out;
};

/** ヘッダー付き/ヘッダー無し(profile指定)を透過的に読む */
const loadAny = (f) => (f.profile ? loadProfileFile(f.path, f.kind, f.profile) : loadFile(f.path, f.kind));

/* =====================================================================
 * 4. 入力ファイルの統合(出馬表を軸に、他CSVを馬へJOIN)
 *    JOINキー: 場所+R+馬番 を優先、無ければ 馬名
 * ===================================================================== */
let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
} catch (e) {
  die(`設定ファイル ${CONFIG_PATH} を読み込めません: ${e.message}`);
}
const baseDir = dirname(resolve(CONFIG_PATH));
const files = (config.files ?? []).map((f) => ({ ...f, path: resolve(baseDir, f.path) }));
const KINDS = ["shutuba", "unified", "zenso", "pedigree", "training", "odds", "supplement"];
for (const f of files) if (!KINDS.includes(f.kind)) die(`不明なkind: ${f.kind}(使用可能: ${KINDS.join("/")})`);

const primary = files.filter((f) => f.kind === "shutuba" || f.kind === "unified");
if (!primary.length) die("kind が shutuba または unified のCSVが最低1つ必要です(出走馬の軸になります)");

const horses = new Map(); // fullKey → 統合レコード
const byName = new Map(); // 馬名 → fullKey
const fullKey = (r) => (r.track && r.raceNo && r.horseNo ? `${r.track}|${z2h(r.raceNo)}|${z2h(r.horseNo)}` : null);

/* 4-1. 軸となる出走馬を登録 */
for (const f of primary) {
  for (const rec of loadAny(f)) {
    if (!rec.name && !rec.horseNo) { warn(`${f.path}: 馬名も馬番も無い行をスキップ`); continue; }
    const key = fullKey(rec) ?? `name|${rec.name}`;
    if (horses.has(key)) warn(`${f.path}: 重複行(${rec.name ?? key})は後の値で上書きします`);
    horses.set(key, { ...horses.get(key), ...rec, __key: key, trainingRows: horses.get(key)?.trainingRows ?? [] });
    if (rec.name) byName.set(rec.name, key);
  }
}
info(`出走馬の軸: ${horses.size}頭`);

/* 4-2. 補助CSVをJOIN */
const findHorse = (rec, path) => {
  const key = fullKey(rec);
  if (key && horses.has(key)) return horses.get(key);
  if (rec.name && byName.has(rec.name)) return horses.get(byName.get(rec.name));
  warn(`${path}: 出走馬に紐づかない行(${rec.name ?? JSON.stringify(rec).slice(0, 40)})を無視`);
  return null;
};
/* 馬名を供給する supplement / odds を先に処理し、名前でのJOIN索引を随時更新する */
const AUX_ORDER = { supplement: 0, odds: 0, zenso: 1, pedigree: 1, training: 1 };
const auxFiles = files
  .filter((f) => f.kind !== "shutuba" && f.kind !== "unified")
  .sort((a, b) => (AUX_ORDER[a.kind] ?? 1) - (AUX_ORDER[b.kind] ?? 1));
for (const f of auxFiles) {
  for (const rec of loadAny(f)) {
    const h = findHorse(rec, f.path);
    if (!h) continue;
    if (f.kind === "training") {
      h.trainingRows.push(rec);
    } else {
      for (const [k, v] of Object.entries(rec)) if (v !== "" && v != null) h[k] = v; // odds等は上書き(最新優先)
      if (rec.name && h.__key) byName.set(rec.name, h.__key); // 後続CSVの馬名JOIN用
    }
  }
}

/* ---- 必須フィールド(馬名/単勝オッズ)の充足チェックと補完テンプレート ---- */
let approxOdds = false;
{
  const byRaceKey = new Map();
  for (const h of horses.values()) {
    const rk = `${h.track}${z2h(h.raceNo)}R`;
    if (!byRaceKey.has(rk)) byRaceKey.set(rk, []);
    byRaceKey.get(rk).push(h);
  }
  const numSort = (a, b) => (toNum(a.horseNo) ?? 0) - (toNum(b.horseNo) ?? 0);
  let missNameTotal = 0, missOddsTotal = 0;
  const oddsLines = [];
  for (const [rk, list] of byRaceKey) {
    list.sort(numSort);
    const mn = list.filter((h) => !h.name).map((h) => z2h(h.horseNo));
    const mo = list.filter((h) => toNum(h.winOdds) == null).map((h) => z2h(h.horseNo));
    missNameTotal += mn.length;
    missOddsTotal += mo.length;
    if (mn.length) warn(`${rk}: 馬名が未入力の馬番 → ${mn.join(", ")} (全${list.length}頭中 ${mn.length}頭)`);
    if (mo.length) oddsLines.push(`${rk}: 単勝オッズが未入力の馬番 → ${mo.join(", ")} (全${list.length}頭中 ${mo.length}頭)`);
  }

  if (missNameTotal || missOddsTotal) {
    /* 初心者向けテンプレート: #説明行つき・場所/R/馬番/人気はプレ入力済み */
    const tplPath = join(baseDir, "supplement-template.csv");
    const sorted = [...horses.values()].sort(
      (a, b) => (a.track + z2h(a.raceNo)).localeCompare(b.track + z2h(b.raceNo), "ja") || numSort(a, b)
    );
    writeFileSync(
      tplPath,
      "# supplement.csv の書き方(この#で始まる2行は消さなくてOK。読み込み時に自動で無視されます)\n" +
        "# TARGETの出馬表を見ながら 馬名・騎手・単勝オッズ(例: 3.2)・人気(例: 1) を入力。場所/R/馬番は変更しないでください。\n" +
        "場所,R,馬番,馬名,騎手,単勝オッズ,人気\n" +
        sorted
          .map(
            (h) =>
              `${h.track},${z2h(h.raceNo)},${z2h(h.horseNo)},${h.name ?? ""},${h.jockey ?? ""},${toNum(h.winOdds) ?? ""},${z2h(String(h.popularity ?? ""))}`
          )
          .join("\n") + "\n"
    );
    info(`補完テンプレートを出力: ${tplPath}`);
    info(`  → 入力後に supplement.csv 等へリネームし、csv-config.json の files に { "kind": "supplement", "path": "supplement.csv" } を追加して再実行`);

    for (const h of horses.values()) if (!h.name) h.name = `${z2h(h.horseNo)}番(馬名未設定)`;

    if (missOddsTotal) {
      if (args.force) {
        oddsLines.forEach((l) => warn(l));
        const APPROX = { 1: 2.8, 2: 4.6, 3: 6.5, 4: 9, 5: 12, 6: 16, 7: 21, 8: 27, 9: 35, 10: 45, 11: 57, 12: 72, 13: 90, 14: 110, 15: 130, 16: 150, 17: 170, 18: 190 };
        for (const h of horses.values()) {
          if (toNum(h.winOdds) != null) continue;
          const p = toNum(h.popularity);
          if (p == null) die(`${h.name}: 単勝オッズも人気も無く、EVを計算できません`);
          h.winOdds = String(APPROX[Math.min(p, 18)]);
        }
        approxOdds = true;
        warn("--force: 単勝オッズを人気からの概算で仮置きしました。EV/TM VALUEは参考値です(meta.oddsApproximated + meta.oddsNote を付与)");
      } else {
        oddsLines.forEach((l) => err(l));
        die(`単勝オッズが計${missOddsTotal}頭で未入力です。supplement-template.csv を埋めて再実行してください(急ぎの場合のみ --force で概算ドラフト)`);
      }
    }
  } else {
    info("必須フィールド(馬名/単勝オッズ)はすべて充足しています");
  }
}

/* =====================================================================
 * 5. レースへグループ化
 * ===================================================================== */
const raceMap = new Map();
for (const h of horses.values()) {
  if (!h.track || !h.raceNo) die(`「場所」「R」列は必須です(馬: ${h.name ?? "?"})。TARGETの出力項目に追加してください`);
  const rk = `${h.track}|${z2h(h.raceNo)}`;
  if (!raceMap.has(rk)) raceMap.set(rk, { track: h.track, raceNo: parseInt(z2h(h.raceNo), 10), rows: [] });
  raceMap.get(rk).rows.push(h);
}

const raceDateOf = (rows) => parseDate(rows.find((r) => r.date)?.date);

/* =====================================================================
 * 6. スコアリング(全て決定的。根拠はREADME「スコア算出ロジック」参照)
 * ===================================================================== */
const BW = { ability: 0.30, course: 0.08, distance: 0.12, pace: 0.10, lap: 0.08, training: 0.12, trainingLap: 0.05, pedigree: 0.10, stable: 0.03, frame: 0.02 };

const scoreAbility = (h, rows) => {
  const withIdx = rows.filter((r) => toNum(r.speedIndex) != null);
  if (withIdx.length >= Math.ceil(rows.length / 2)) {
    if (toNum(h.speedIndex) == null) { warn(`${h.name}: スピード指数が空のため前走ベースで推定`); }
    else {
      const sorted = [...withIdx].sort((a, b) => toNum(b.speedIndex) - toNum(a.speedIndex));
      const rank = sorted.findIndex((r) => r === h);
      const span = sorted.length > 1 ? 36 / (sorted.length - 1) : 0;
      return { v: clamp(92 - rank * span, 52, 95), basis: "TARGETスピード指数" };
    }
  }
  const fin = toNum(h.zensoFinish), fs = toNum(h.zensoFieldSize) ?? 12;
  if (fin != null) {
    const margin = parseMargin(h.zensoMargin);
    return { v: clamp(70 + (0.5 - fin / fs) * 24 - margin * 3, 52, 88), basis: "前走内容からの簡易推定" };
  }
  warn(`${h.name}: 能力の根拠列(スピード指数/前走着順)が無く中立値65を設定。手動調整を推奨`);
  return { v: 65, basis: "データ不足のため中立" };
};

const scoreDistance = (h, race) => {
  if (h.pastRuns?.length) {
    const diffs = h.pastRuns.map((p) => Math.abs(race.distance - (toNum(p.distance) ?? race.distance)));
    const same = h.pastRuns.filter((p) => toNum(p.distance) === race.distance).length;
    return clamp(84 - (Math.min(...diffs) / 200) * 5 + Math.min(same, 4) * 1.5, 52, 94);
  }
  const zd = toNum(h.zensoDistance);
  if (zd == null) return 68;
  let v = 84 - (Math.abs(race.distance - zd) / 200) * 4;
  if (h.zensoSurface && normSurface(h.zensoSurface) !== race.surface) v -= 6;
  return clamp(v, 50, 92);
};
const scoreCourse = (h, race) => {
  if (h.pastRuns?.length && race._cc) {
    const same = h.pastRuns.filter((p) => p.courseCode === race._cc).length;
    const sfMatch = h.pastRuns[0] && normSurface(h.pastRuns[0].surface) === race.surface;
    return clamp(66 + Math.min(same, 3) * 6 + (sfMatch ? 2 : 0) + jit(h.name, 1, 2), 55, 92);
  }
  let v = 70;
  if (h.zensoTrack === race.track) v += 10;
  if (h.zensoSurface && normSurface(h.zensoSurface) === race.surface) v += 4;
  return clamp(v + jit(h.name, 1, 2), 55, 90);
};
const scorePace = (h, race, inner) => {
  const base = { 逃げ: 80, 先行: 78, 差し: 72, 追込: 66 }[h.style] ?? 70;
  return clamp(base + (inner && (h.style === "逃げ" || h.style === "先行") ? 4 : 0) + jit(h.name, 2, 2), 55, 90);
};
const scoreLap = (h, race) => {
  const agari = toNum(h.zensoAgari);
  if (agari == null) {
    const m = h.zensoMargin !== "" && h.zensoMargin != null ? parseMargin(h.zensoMargin) : null;
    if (m == null) return 70;
    return clamp(80 - m * 6, 56, 86); // 上り3F未取得時は前走着差を近接度の代理指標に
  }
  const th = race.surface === "ダート" ? 0.8 : 0; // ダートは基準を緩める
  return clamp(agari <= 34.0 + th ? 85 : agari <= 34.6 + th ? 80 : agari <= 35.3 + th ? 74 : 67, 55, 90);
};
const EVAL_SCORE = { A: 90, B: 80, C: 70, D: 60, E: 50 };
const scoreTraining = (h) => {
  const g = z2h(String(h.trainEvalResolved ?? "")).toUpperCase();
  if (EVAL_SCORE[g]) return EVAL_SCORE[g];
  const w = h.oneWeek;
  if (!w || w.last1F == null) return h.oneWeekTime ? 74 : 65;
  const hill = (w.course ?? "").includes("坂");
  let v = hill
    ? (w.last1F <= 12.0 ? 87 : w.last1F <= 12.5 ? 80 : w.last1F <= 13.0 ? 73 : 66)
    : (w.last1F <= 11.5 ? 88 : w.last1F <= 12.0 ? 82 : w.last1F <= 12.5 ? 75 : 67);
  if (w.laps && w.laps[3] <= w.laps[2] && w.laps[2] <= w.laps[1]) v += 3; // 加速ラップ
  if ((h.trainCountTotal ?? 0) >= 5) v += 2; // 乗り込み量
  return clamp(v, 55, 93);
};
const scoreTrainingLap = (h) => {
  const w = h.oneWeek;
  const minLap = w?.laps ? Math.min(...w.laps) : toNum(w?.last1F ?? h.oneWeekLast1F);
  if (minLap == null) return 66;
  return clamp(minLap <= 11.5 ? 89 : minLap <= 12.0 ? 83 : minLap <= 12.5 ? 76 : minLap <= 13.0 ? 70 : 64, 55, 92);
};
const scoreFrame = (h, fieldSize) => {
  const no = toNum(h.horseNo) ?? 1;
  const third = fieldSize / 3;
  return clamp((no <= third ? 78 : no <= third * 2 ? 72 : 66) + jit(h.name, 3, 2), 55, 88);
};
function normSurface(s) {
  const t = z2h(String(s ?? ""));
  if (t.includes("ダ")) return "ダート";
  if (t.includes("芝")) return "芝";
  if (t.includes("障")) return "障害";
  return t || "芝";
}

/* 調教行の解析: 累計(例 "53.7-38.6-24.7-12.2")から4F時計とラップを算出 */
const parseSession = (t, raceDate) => {
  const d = parseDate(t.trainDate ?? t.date);
  const diff = d && raceDate ? Math.round((raceDate - d) / 864e5) : null;
  let time4F = toNum(t.trainTime), last1F = toNum(t.trainLast1F), laps = null;
  const cumRaw = t.trainCumulative ?? "";
  if (cumRaw) {
    const cum = z2h(cumRaw).split(/[-\s]+/).map(Number).filter(Number.isFinite);
    if (cum.length >= 4) {
      const t4 = cum.slice(-4); // [4F, 3F, 2F, 1F] 累計
      time4F = t4[0];
      last1F = t4[3];
      laps = [t4[0] - t4[1], t4[1] - t4[2], t4[2] - t4[3], t4[3]].map((v) => Math.round(v * 10) / 10);
    }
  }
  const phase = diff == null ? "不明" : diff <= 4 ? "最終" : diff <= 12 ? "一週前" : "中間";
  const isWork = last1F != null && last1F <= 14.5; // 実追い切りらしさ(終い14.5秒以内)
  return {
    date: d ? isoDate(d) : null, daysBefore: diff, course: t.trainCourse ?? null,
    time: time4F, last1F, laps, eval: t.trainEval ?? null, phase, isWork,
  };
};

const assignTraining = (h, raceDate) => {
  h.sessions = (h.trainingRows ?? []).map((t) => parseSession(t, raceDate));
  const pickFastest = (phase) => {
    const cand = h.sessions.filter((x) => x.phase === phase && x.time != null);
    if (!cand.length) return null;
    const works = cand.filter((x) => x.isWork);
    return (works.length ? works : cand).sort((a, b) => a.time - b.time)[0];
  };
  h.oneWeek = pickFastest("一週前");
  h.final = pickFastest("最終");
  h.midCount = h.sessions.filter((x) => x.phase === "中間").length;
  h.trainCountTotal = h.sessions.length;
  // 統合CSVの列からのフォールバック
  if (!h.oneWeek && (h.oneWeekTime || h.oneWeekLast1F))
    h.oneWeek = { time: toNum(h.oneWeekTime), course: h.oneWeekCourse ?? null, last1F: toNum(h.oneWeekLast1F), laps: null };
  if (!h.final && (h.finalTime || h.finalLast1F))
    h.final = { time: toNum(h.finalTime), last1F: toNum(h.finalLast1F), laps: null };
  h.trainEvalResolved = h.trainEval ?? h.oneWeek?.eval ?? h.final?.eval ?? null;
};

/* 調教の文章(事実のみ): 「一週前(6/24)は栗東坂路で4F51.3-1F11.9(ラップ 13.5-13.5-12.4-11.9)。…」 */
const f1 = (v) => (v == null ? "" : Number(v).toFixed(1));
const sessionText = (w) => {
  if (!w) return null;
  const dt = w.date ? `${+w.date.slice(5, 7)}/${+w.date.slice(8, 10)}` : "日付未取得";
  const lap = w.laps ? `(ラップ ${w.laps.map(f1).join("-")})` : "";
  const head = `${dt}に${w.course ?? "調教"}で4F${f1(w.time)}${w.last1F != null ? `-1F${f1(w.last1F)}` : ""}${lap}`;
  const accel = w.laps && w.laps[3] <= w.laps[2] && w.laps[2] <= w.laps[1];
  const tail =
    accel && w.last1F != null && w.last1F <= 13.0 ? "。終いまで加速する好内容です"
    : w.last1F != null && w.last1F <= 12.0 ? "。終いの脚は鋭い水準です"
    : w.last1F != null && w.last1F <= 13.0 ? "。まずまずの動きです"
    : w.last1F != null && w.last1F <= 14.5 ? "。終いは平凡な時計です"
    : "。軽めの調整です";
  return head + tail;
};

/* 血統: 父/母/母父/母の母(TARGET出馬表) + 既知種牡馬の傾向ノート・適性補正 */
const SIRE_NOTES = {
  "ロードカナロア": "芝短距離〜マイルで実績豊富な一流スプリント血統",
  "ビッグアーサー": "高松宮記念勝ち馬。生粋のスプリンター血統",
  "ミッキーアイル": "快速マイラー。産駒も短距離向きの速さが持ち味",
  "ファインニードル": "スプリントGI2勝馬。短距離のスピード血統",
  "マテラスカイ": "米国型のダート短距離血統。テンの速さが武器",
  "サトゥルナーリア": "自身は芝中距離GI馬。産駒は初期世代",
  "War Front": "米国の快速血統。芝ダート兼用のスピード",
  "アニマルキングダム": "米ダービー馬。パワーとスピードの米国血統",
  "American Pharoah": "米三冠馬。スピードの絶対値が高い血統",
  "ルーラーシップ": "キングカメハメハ系のスタミナ・底力型",
  "タリスマニック": "BCターフ勝ち馬。欧州芝の中距離型",
  "リオンディーズ": "キングカメハメハ系の万能型",
  "イスラボニータ": "フジキセキ系の堅実なマイル〜中距離型",
};
const DAMSIRE_NOTES = {
  "ディープインパクト": "瞬発力を補強する名血",
  "スペシャルウィーク": "底力を補強",
  "サクラバクシンオー": "短距離適性を強く補強するスプリント名母父",
  "ハーツクライ": "スタミナと成長力を補強",
  "ミッキーアイル": "スピードを補強",
  "スウェプトオーヴァーボード": "米国型のスピードを補強",
  "ケイムホーム": "短距離向きの機動力を補強",
  "ゼンノロブロイ": "堅実さと底力を補強",
  "Redoute's Choice": "豪州の名スプリント・マイル血統",
  "ダンスインザダーク": "スタミナを補強",
  "Bernardini": "米国のパワーを補強",
};
const SPRINT_SIRES = new Set(["ロードカナロア", "ビッグアーサー", "ミッキーアイル", "ファインニードル", "マテラスカイ", "War Front"]);
const STAMINA_SIRES = new Set(["ルーラーシップ", "タリスマニック"]);
const SPRINT_DAMSIRES = new Set(["サクラバクシンオー", "ミッキーアイル", "ケイムホーム", "スウェプトオーヴァーボード", "Redoute's Choice"]);

const buildPedigree = (h, f) => {
  const line = (role, name, note) => ({ role, name: name || "(未取得)", note });
  if (!h.sire) warn(`${h.name}: 血統列が不足(父/母父)。TARGET出力に血統項目を追加してください`);
  const base = {
    course: f.course, distance: f.distance, going: (f.ability + f.distance) / 2, lap: f.lap,
    family: 60 + (h.runsCount ?? 0) * 6, speed: f.ability, stamina: f.distance, burst: f.ability, sustain: f.lap,
  };
  const scores = {};
  Object.keys(base).forEach((k, i) => { scores[k] = clamp(base[k] + jit(h.name, 10 + i, 3)); });
  /* 既知種牡馬による適性補正(実データに基づく決定的な調整) */
  if (h.sire && SPRINT_SIRES.has(h.sire)) { scores.speed = clamp(scores.speed + 6); scores.distance = clamp(scores.distance + 4); scores.stamina = clamp(scores.stamina - 2); }
  if (h.sire && STAMINA_SIRES.has(h.sire)) { scores.stamina = clamp(scores.stamina + 5); scores.sustain = clamp(scores.sustain + 4); scores.speed = clamp(scores.speed - 3); }
  if (h.damSire && SPRINT_DAMSIRES.has(h.damSire)) scores.speed = clamp(scores.speed + 3);
  if (h.damSire === "ディープインパクト") scores.burst = clamp(scores.burst + 4);
  if (h.damSire === "ダンスインザダーク" || h.damSire === "ハーツクライ") scores.stamina = clamp(scores.stamina + 3);

  if (h.sire) {
    return {
      lines: [
        line("父", h.sire, SIRE_NOTES[h.sire] ?? "血統表より取得"),
        line("母", h.dam, "血統表より取得"),
        line("母父", h.damSire, DAMSIRE_NOTES[h.damSire] ?? "血統表より取得"),
        line("母の母", h.damDam ?? h.damDamSire, "血統表より取得"),
      ],
      scores,
    };
  }
  return {
    lines: [
      line("父", null, "TARGET血統出力の接続後に表示されます"),
      line("母", null, "TARGET血統出力の接続後に表示されます"),
      line("母父", null, "TARGET血統出力の接続後に表示されます"),
      line("母の母", null, "TARGET血統出力の接続後に表示されます"),
    ],
    scores,
  };
};

/* 期待値(サイト側lib/logicと同一式) */
const winProb = (h, field, k = 7) => {
  const w = (x) => Math.pow(x.aiScore / 100, k);
  return w(h) / field.reduce((s, x) => s + w(x), 0);
};

/* =====================================================================
 * 7. テンプレート文章(縮退運転品質。LLMで磨く場合は llm-enrich-prompt.txt)
 * ===================================================================== */
const FACTOR_JA = { ability: "能力", course: "コース適性", distance: "距離適性", pace: "展開", lap: "ラップ適性", training: "調教", trainingLap: "調教ラップ", stable: "厩舎", frame: "枠順" };
const PROS_TEXT = {
  ability: "指数の裏付けとなる能力値が水準以上", course: "同コースへの適性が数字に表れている",
  distance: "今回の距離への適性が高い", pace: "脚質と枠の組み合わせで展開が向きやすい",
  lap: "前走の上がりからラップ適性が見込める", training: "調教内容が良好", trainingLap: "追い切りの終いが速い",
  stable: "厩舎の仕上げが安定", frame: "枠順の並びが有利",
};
const CONS_TEXT = {
  ability: "能力値に上位との差がある", course: "今回のコースは根拠となる実績が薄い",
  distance: "今回の距離は適性の裏付けが弱い", pace: "脚質的に展開への依存度が高い",
  lap: "求められるラップへの適性が未知数", training: "調教からは強調材料が乏しい",
  trainingLap: "追い切りの終いに物足りなさが残る", stable: "厩舎データの裏付けが薄い", frame: "枠順の並びが割引材料",
};
const posText = (style, inner) =>
  style === "逃げ" ? "ハナを主張する" : style === "先行" ? (inner ? "好位の内を確保する" : "好位外めを追走する")
  : style === "差し" ? "中団で脚を溜める" : style === "追込" ? "後方から直線勝負に懸ける" : "流れに応じた位置を取る";

const buildTexts = (h, race, rank, ev) => {
  const f = h.factors;
  const inner = (toNum(h.horseNo) ?? 1) <= race.fieldSize / 3;
  const style = h.style ?? "自在";
  const sortedF = Object.entries(f).sort((a, b) => b[1] - a[1]);
  const top2 = sortedF.slice(0, 2).map(([k]) => k);
  const bottom2 = sortedF.slice(-2).map(([k]) => k).reverse();
  const mNum = h.zensoMargin !== "" && h.zensoMargin != null ? parseMargin(h.zensoMargin) : null;
  const zenso = toNum(h.zensoFinish) != null
    ? `前走${h.zensoTrack ?? ""}${h.zensoDistance ? h.zensoDistance + "m" : ""}で${h.zensoFinish}着`
    : mNum != null
      ? `前走は${h.zensoSurface ? normSurface(h.zensoSurface) : ""}${h.zensoDistance ?? "?"}mで勝ち馬と${mNum.toFixed(1)}秒差`
      : "前走データ未取得";
  const trText = h.oneWeek
    ? `一週前に${h.oneWeek.course ?? "調教"}で${h.oneWeek.time ?? "時計"}${h.oneWeek.last1F ? `(終い${h.oneWeek.last1F})` : ""}`
    : "一週前の追い切りデータ未取得";

  const zensoShort = toNum(h.zensoFinish) != null
    ? `前走${h.zensoFinish}着`
    : mNum != null ? `前走${mNum.toFixed(1)}秒差` : "前走情報なし";
  h.comment = `${style}型。${zensoShort}・指数レース${rank}位`;
  h.tags = [
    `${style}`,
    ...(toNum(h.zensoDistance) === race.distance ? ["同距離実績"] : []),
    ...(toNum(h.intervalWeeks) >= 16 ? ["休み明け"] : []),
    ...(["A", "B"].includes(z2h(String(h.trainEvalResolved ?? "")).toUpperCase()) ? ["調教良好"] : []),
    ...(ev.ev >= 1.15 ? ["妙味"] : []),
  ].slice(0, 4);
  h.insight = [
    `TM INDEXはレース${rank}位。算出根拠は${h.abilityBasis}`,
    `${style}×${h.horseNo}番枠。${posText(style, inner)}想定`,
    ev.ev >= 1.15
      ? `指数${rank}位に対して${h.popularity}人気。期待値${ev.ev.toFixed(2)}に妙味`
      : trText.slice(0, 34),
  ];
  h.pros = top2.map((k) => PROS_TEXT[k]);
  h.cons = bottom2.map((k) => CONS_TEXT[k]);
  h.commentary =
    `今回は${race.track}${race.surface}${race.distance}m。${style}の同馬は${h.horseNo}番枠から` +
    `${posText(style, inner)}競馬を想定します。${zenso}。${trText}。` +
    `ファクターでは${FACTOR_JA[top2[0]]}が最上位で、総合ではレース${rank}位のTM INDEX ${h.aiScore}。` +
    `※本文はCSVからの自動生成です。コース形状・展開の踏み込んだ考察はLLM/手動での追記を推奨します。`;
  h.frameEvalObj = {
    score: f.frame,
    text: `${race.fieldSize}頭立ての${h.horseNo}番枠。${inner ? "序盤のロスが少ない内めの並び" : "揉まれにくい外めの並び"}で、${style}の脚質とは${f.pace >= 74 ? "噛み合う" : "工夫が要る"}組み合わせです。`,
  };
  const grade = z2h(String(h.trainEvalResolved ?? "")).toUpperCase();
  const gradeFinal = EVAL_SCORE[grade] ? grade : f.training >= 85 ? "A" : f.training >= 75 ? "B" : f.training >= 65 ? "C" : "D";
  h.trainingEvalObj = {
    grade: gradeFinal,
    oneWeek: {
      score: f.training,
      text: h.oneWeek ? `一週前は${sessionText(h.oneWeek)}` : "一週前追い切りのデータは未取得です。評価は中立値としています。",
    },
    final: {
      status: h.final ? "確認済み" : "未取得",
      text: h.final ? `最終は${sessionText(h.final)}` : "最終追い切りのデータは未取得です(評価は一週前を主要材料としています)。",
    },
    stablePattern: {
      match: ["A", "B"].includes(gradeFinal),
      text: "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。",
    },
    volume: h.trainCountTotal
      ? { total: h.trainCountTotal, mid: h.midCount ?? 0, note: `直近の登坂・追い切りは計${h.trainCountTotal}本(うち中間調整${h.midCount ?? 0}本)。乗り込み量は${h.trainCountTotal >= 6 ? "豊富" : h.trainCountTotal >= 3 ? "標準" : "少なめ"}です。` }
      : { total: 0, mid: 0, note: "調教データ未取得。" },
  };
  const runs = h.runsCount ?? 0;
  const longLayoff = (toNum(h.intervalWeeks) ?? 0) >= 16;
  h.confidence = runs >= 3 && h.oneWeek && !longLayoff ? "high" : runs >= 1 ? "mid" : "low";
  h.confidenceReasons =
    h.confidence === "high"
      ? ["近走データが3走分以上揃っている", "一週前追い切りの時計を確認済み", h.abilityBasis === "TARGETスピード指数" ? "スピード指数による能力の裏付けあり" : "前走内容による能力の裏付けあり"]
      : h.confidence === "mid"
        ? [
            longLayoff ? `出走間隔${h.intervalWeeks}週の長期休養明けで状態評価に振れ幅がある` : "近走データが限定的で指数に振れ幅が残る",
            h.oneWeek ? "調教時計は確認済みだが休養明けの実戦感は未知数" : "一週前追い切りのデータが未取得",
            h.abilityBasis === "TARGETスピード指数" ? "能力はスピード指数で裏付けあり" : "一部スコアは簡易推定",
          ]
        : ["前走データが取得できずデータ不足", "能力値を中立で扱っている", "手動またはLLMでの補完を推奨"];
};

/* ---- クロス分析: 取れているデータの掛け合わせのみ算出し、それ以外は「未取得」 ---- */
const NA = (need) => ({ status: "未取得", note: `${need}の接続後に自動算出されます` });
const buildCross = (h, race, rank, ev) => {
  const f = h.factors;
  return {
    indexXvalue: {
      status: "ok",
      score: Math.round(Math.min(99, ev.ev * 50)),
      note: `指数${rank}位 × ${h.popularity}人気 → 単勝期待値${ev.ev.toFixed(2)}`,
    },
    styleXpace: h.style
      ? { status: "ok", score: f.pace, note: `${h.style} × ${h.horseNo}番枠の展開適合` }
      : NA("脚質データ(supplement の脚質列 または TARGET出力)"),
    trainingXfreshness:
      h.oneWeek
        ? { status: "ok", score: Math.round((f.training + (toNum(h.intervalWeeks) >= 16 ? 60 : 80)) / 2), note: `一週前追い切り × 間隔${h.intervalWeeks ?? "?"}週` }
        : toNum(h.intervalWeeks) != null
          ? { status: "部分", score: null, note: `間隔${h.intervalWeeks}週のみ取得。調教データ接続後に完全化` }
          : NA("調教データ"),
    pedigreeXcourse: h.sire ? { status: "ok", score: Math.round((pedigreeIndexOf(h) + f.course) / 2), note: "血統 × コース適性" } : NA("血統データ(父/母父/母母父)"),
    goingXpedigree: NA("馬場状態履歴 × 血統データ"),
  };
};
const pedigreeIndexOf = (h) => Math.round(Object.values(h.pedigreeObj.scores).reduce((a, b) => a + b, 0) / 9);

/* =====================================================================
 * 8. 変換本体
 * ===================================================================== */
const racesOut = [];
let globalDate = null;
let oddsTime = null;

for (const { track, raceNo, rows } of raceMap.values()) {
  const first = rows[0];
  const cfgRace = (config.races ?? []).find((r) => r.track === track && +r.raceNo === raceNo);
  /* レース日: races[].date → CSVの日付列 → config.meta.date の順で解決(調教の最終/一週前判定に必須) */
  const raceDate = parseDate(cfgRace?.date) ?? raceDateOf(rows) ?? parseDate(config.meta?.date);
  if (!raceDate) warn(`${track}${raceNo}R: レース日が特定できず、調教の最終/一週前判定ができません(meta.date を設定してください)`);
  if (raceDate) globalDate = raceDate;
  const surface = normSurface(first.surface);
  const distance = toNum(first.distance);
  if (!distance) die(`${track}${raceNo}R: 距離が取得できません(「距離」列を確認)`);
  const fieldSize = rows.length;
  const declared = toNum(first.fieldSize);
  if (declared && declared !== fieldSize)
    warn(`${track}${raceNo}R: 頭数列(${declared})とCSV行数(${fieldSize})が不一致。行数を採用します`);

  const race = {
    id: `${trackId(track)}-${raceNo}`,
    track, number: raceNo,
    name: cfgRace?.name ?? (first.raceName || `${track}${raceNo}R`),
    grade: cfgRace?.grade ?? normGrade(first.raceClass) ?? normGrade(first.raceName),
    time: cfgRace?.time ?? z2h(first.startTime || "00:00"),
    surface, distance,
    going: cfgRace?.going ?? (first.going || "良"),
    fieldSize,
    category: cfgRace?.category ?? null,
    displayTarget: cfgRace?.displayTarget ?? true,
    featuredPriority: cfgRace?.featuredPriority ?? 0,
    horses: [],
  };
  if (!race.grade) delete race.grade;
  race.category = raceCategory(race);
  race._cc = first.courseCode ?? null; // 過去走との同コース照合用(出力前に削除)
  if (!cfgRace && !first.raceName)
    warn(`${track}${raceNo}R: レース名・発走時刻がCSVに無いため既定値を使用。csv-config.json の "races" で指定できます`);

  // 馬ごとの下処理
  for (const h of rows) {
    h.style = normStyle(h.runningStyle);
    if (!h.style) { info(`${h.name}: 脚質列が無いため展開スコアは中立`); }
    h.runsCount = h.pastRuns?.length ?? [h.zensoFinish, h.finish2, h.finish3].filter((x) => toNum(x) != null).length;
    assignTraining(h, raceDate);
    if (h.oddsTime) oddsTime = h.oddsTime;
  }

  // スコアリング(2パス: factors→aiScore→rank/EV→テキスト)
  for (const h of rows) {
    const ab = scoreAbility(h, rows);
    h.abilityBasis = ab.basis;
    const f = {
      ability: ab.v,
      course: scoreCourse(h, race),
      distance: scoreDistance(h, race),
      pace: scorePace(h, race, (toNum(h.horseNo) ?? 1) <= fieldSize / 3),
      lap: scoreLap(h, race),
      training: 0, trainingLap: 0, // 後段
      stable: clamp(68 + jit(h.name, 4, 2), 60, 76), // 厩舎データ未接続のため中立帯
      frame: scoreFrame(h, fieldSize),
    };
    f.training = scoreTraining(h);
    f.trainingLap = scoreTrainingLap(h);
    h.factors = f;
    h.pedigreeObj = buildPedigree(h, f);
    const pedIdx = Math.round(Object.values(h.pedigreeObj.scores).reduce((a, b) => a + b, 0) / 9);
    h.aiScore = clamp(
      f.ability * BW.ability + f.course * BW.course + f.distance * BW.distance + f.pace * BW.pace +
      f.lap * BW.lap + f.training * BW.training + f.trainingLap * BW.trainingLap +
      pedIdx * BW.pedigree + f.stable * BW.stable + f.frame * BW.frame, 50, 96);
    if (toNum(h.winOdds) == null) die(`${h.name}: 単勝オッズが取得できません(オッズはEV計算に必須)`);
    h.odds = toNum(h.winOdds);
  }
  // 人気が無ければオッズ順から導出
  const needPop = rows.some((h) => toNum(h.popularity) == null);
  if (needPop) {
    warn(`${track}${raceNo}R: 人気列が無いためオッズ順から導出しました`);
    [...rows].sort((a, b) => a.odds - b.odds).forEach((h, i) => { h.popularity = i + 1; });
  } else rows.forEach((h) => { h.popularity = toNum(h.popularity); });

  const byScore = [...rows].sort((a, b) => b.aiScore - a.aiScore);
  for (const h of rows) {
    const rank = byScore.indexOf(h) + 1;
    const p = winProb(h, rows);
    const ev = { prob: p, ev: p * h.odds };
    buildTexts(h, race, rank, ev);
    race.horses.push({
      id: `${trackId(track)}${raceNo}-${pad2(toNum(h.horseNo) ?? race.horses.length + 1)}`,
      number: toNum(h.horseNo) ?? race.horses.length + 1,
      name: h.name,
      jockey: h.jockey || "騎手未定",
      popularity: h.popularity,
      odds: h.odds,
      aiScore: h.aiScore,
      comment: h.comment,
      analysis: {
        tags: h.tags,
        factors: h.factors,
        insight: h.insight,
        pros: h.pros,
        cons: h.cons,
        commentary: h.commentary,
        frameEval: h.frameEvalObj,
        trainingEval: h.trainingEvalObj,
        pedigree: h.pedigreeObj,
        confidence: h.confidence,
        confidenceReasons: h.confidenceReasons,
        factorsDetail: {},
        verdict: { status: "missing", label: null, summary: null, evidence: [] },
        topSignal: { status: "missing", label: null, summary: null },
        /* --- クロス分析スロット(複数ファクターの掛け合わせ。未取得は正直に明示) --- */
        crossAnalysis: buildCross(h, race, rank, ev),
      },
      /* --- TARGET完全連携用の生データ層(取得済みはそのまま、未取得はnull) --- */
      raw: {
        weight: toNum(h.weight),                 // 斤量
        horseWeight: toNum(h.horseWeight),       // 馬体重
        weightDiff: toNum(h.weightDiff),         // 増減
        intervalWeeks: toNum(h.intervalWeeks),   // 出走間隔(週)
        speedIndex: toNum(h.speedIndex),         // TARGET指数
        runningStyle: h.style ?? null,           // 脚質
        pastRuns: (h.pastRuns ?? []).map((p) => ({
          courseCode: p.courseCode ?? null,
          track: null,                            // コースコード→場名の対応確定後に充填
          distance: toNum(p.distance),
          surface: p.surface ?? null,
          margin: p.margin ?? null,               // 着差(秒)
          finish: null, passing: null, agari: null, class: null, going: null, date: null, index: null,
        })),
        trainingSessions: (h.sessions ?? []).map((x) => ({
          date: x.date, course: x.course, time4F: x.time, last1F: x.last1F,
          laps: x.laps,                            // [Lap4, Lap3, Lap2, Lap1]
          phase: x.phase,                          // 最終 / 一週前 / 中間 / 不明
          eval: x.eval,
        })),
        trainingCount: h.trainCountTotal ?? 0,     // 本数
        damDam: h.damDam ?? null,                  // 母の母
        review: null,                             // 回顧(着順/払戻/ラップ/ペース/上がり順位)はレース確定後に充填
      },
    });
  }
  race.horses.sort((a, b) => a.number - b.number);
  delete race._cc;
  racesOut.push(race);
}
racesOut.sort((a, b) => a.track.localeCompare(b.track, "ja") || a.number - b.number);

/* featured: 指数上位2 + 妙味型1(指数順位が人気より明確に上) */
const allH = racesOut.flatMap((r) => r.horses.map((h) => ({ r, h, ev: winProb(h, r.horses) * h.odds })));
allH.sort((a, b) => b.h.aiScore - a.h.aiScore);
const featured = allH.slice(0, 2).map(({ r, h }) => ({
  horseId: h.id, raceId: r.id, note: `${r.track}${r.number}R TM INDEX top. TM INDEX ${h.aiScore}`,
}));
/* 妙味枠: 指数順位が人気より明確に上(2つ以上) かつ 指数が上位半分の馬から、EV最大を選ぶ */
const rankOf = new Map();
for (const r of racesOut) {
  [...r.horses].sort((a, b) => b.aiScore - a.aiScore).forEach((h, i) => rankOf.set(h.id, i + 1));
}
const valuePick = allH
  .filter(({ r, h, ev }) => {
    const rank = rankOf.get(h.id);
    return (
      h.popularity >= 4 && ev >= 1.0 && h.popularity - rank >= 2 &&
      rank <= Math.ceil(r.horses.length / 2) && !featured.some((f) => f.horseId === h.id)
    );
  })
  .sort((a, b) => b.ev - a.ev)[0];
if (valuePick) featured.push({
  horseId: valuePick.h.id, raceId: valuePick.r.id,
  note: `Value signal detected. EV ${valuePick.ev.toFixed(2)}`,
});
while (featured.length < 3 && allH[featured.length]) {
  const { r, h } = allH[featured.length];
  if (!featured.some((f) => f.horseId === h.id))
    featured.push({ horseId: h.id, raceId: r.id, note: `TM INDEX ${h.aiScore} top-rated signal` });
}

const cfgDate = parseDate(config.meta?.date);
const date = cfgDate ?? globalDate ?? new Date();
if (!cfgDate && !globalDate) warn('開催日が不明のため本日日付を使用しました(csv-config.json の "meta": {"date": "YYYY-MM-DD"} で指定できます)');
const now = new Date();
const top = allH[0];
const featuredRaceId =
  config.meta?.featuredRaceId ??
  [...racesOut].sort((a, b) =>
    (b.featuredPriority ?? 0) - (a.featuredPriority ?? 0) ||
    (b.category === "grade" ? 1 : 0) - (a.category === "grade" ? 1 : 0) ||
    (b.category === "special" ? 1 : 0) - (a.category === "special" ? 1 : 0) ||
    (b.number ?? 0) - (a.number ?? 0)
  )[0]?.id;
const hasRaceData = racesOut.length > 0 && allH.length > 0;

const weekData = {
  meta: {
    date: isoDate(date),
    dateLabel: jaLabel(date),
    venue: hasRaceData ? [...new Set(racesOut.map((r) => r.track))].join(" / ") : "データ未取得",
    updatedAt: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    version: "beta v0.3",
    brand: "TURF MATRIX",
    schemaVersion: 4,
    week: isoWeek(date),
    source: "target-frontier-jv-csv",
    textMode: "csv",
    dataStatus: hasRaceData ? "active" : "missing",
    featuredRaceId,
    ...(oddsTime ? { oddsUpdatedAt: z2h(oddsTime) } : {}),
    ...(approxOdds ? { oddsApproximated: true, oddsNote: "単勝オッズは人気からの概算値です(参考表示)" } : {}),
    ...(files.some((f) => f.profile) ? { inputProfile: files.find((f) => f.profile).profile } : {}),
  },
  dailySummary: {
    text: hasRaceData
      ? `TARGET CSV loaded: ${racesOut.length} races / ${allH.length} runners. Top signal is ${top.h.name}(TM INDEX ${top.h.aiScore}).`
      : "TARGET CSVが未投入です。CSV生成後に実データのみ表示します。",
    highlights: hasRaceData
      ? [
          `TM INDEX top: ${top.h.name}(${top.r.track}${top.r.number}R / ${top.h.aiScore})`,
          valuePick ? `Value signal: ${valuePick.h.name}(EV ${valuePick.ev.toFixed(2)} / popularity ${valuePick.h.popularity})` : "No EV over 1.0 signal detected",
          `Race scope: ${racesOut.map((r) => `${r.track}${r.number}R`).join(" / ")}`,
        ]
      : ["JRA-VAN TARGET CSV未取得"],
  },
  races: racesOut,
  featured,
};

/* =====================================================================
 * 9. 検証 → 出力
 * ===================================================================== */
const { errors, warnings } = validateWeekData(weekData);
warnings.forEach((w) => warn("スキーマ警告: " + w));
errors.forEach((e) => err("スキーマエラー: " + e));

if (errors.length && !args.force) {
  err(`検証エラー${errors.length}件のため出力を中止しました(--force でドラフト出力可)`);
  flushLog();
  process.exit(1);
}

writeFileSync(OUT_PATH, JSON.stringify(weekData, null, 2) + "\n");

/* LLM磨き上げ用プロンプト(モデル非依存) */
const promptPath = join(dirname(resolve(OUT_PATH)), "llm-enrich-prompt.txt");
writeFileSync(promptPath, `あなたはAI Racing Intelligence Platform「TURF MATRIX」の編集担当です。
添付の week-data.json は TARGET frontier JV のCSVから自動生成されたドラフトです。
数値(factors / pedigree.scores / aiScore / odds等)は一切変更せず、
以下の文章フィールドだけを具体的に書き直し、完全なJSONのみを出力してください。

対象: comment / tags / insight(3行・各25字前後) / pros / cons /
      commentary(100〜160字) / frameEval.text / trainingEval各text /
      pedigree.lines[].note / confidenceReasons / dailySummary / featured[].note

ルール:
1. 人気順の後追い表現は禁止(期待値を分析するサービスです)
2. commentary はコース形状・ラップ傾向・脚質・展開・枠順を具体的に絡める
3. 調教は一週前追い切りが主要評価、最終追い切りは確認材料
4. 断定を避け「〜と分析します」の距離感。的中や利益の保証表現は禁止
5. 「※自動生成です」等の注記文はすべて削除する
6. 出力は有効なJSONのみ(前置き・コードブロック記号なし)

完了後は node update-data.mjs で検証・反映してください。
`);

flushLog();
console.log("");
console.log(`✓ ${OUT_PATH} を生成しました: ${racesOut.length}レース ${allH.length}頭`);
console.log(`  変換ログ: ${LOG_PATH} / LLM用プロンプト: ${promptPath}`);
console.log(`  次の手順: node update-data.mjs ${OUT_PATH} turfmetrics-beta.jsx`);
