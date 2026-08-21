# Blood Intelligence Engine v2 監査記録 (2026-08-21)

## 現行経路

- 入力: `tools/parsers/pedigree-html-parser.mjs` / `tools/parsers/jvlink-pedigree-csv-parser.mjs`
- 正規化: `tools/normalizers/race-bundle.mjs` / `tools/normalizers/race-batch.mjs`
- Blood算出: `tools/intelligence/blood-ai.mjs`
- Intelligence統合: `tools/intelligence/index.mjs`
- 出力契約: `tools/intelligence/verdict-engine.mjs`
- UI: `src/App.jsx` の `PedigreeCard`
- 統計: `data/master/bloodlines.json`

## 監査結果

1. 現行Bloodは父だけではなく、母父・母系・父父・4代祖先候補、系統辞書、牝系辞書、コース文脈を参照している。
2. スコアは `blood-ai.mjs` で決定的に算出され、TM INDEXへ既存weightのまま接続されている。
3. UIが主に汎用headlineを表示するため、内部に存在する父・母父・統計根拠が見えにくかった。
4. 今週のJV-Link血統は多くが `basic-4-line` であり、30祖先を持つ完全な4代血統ではない。コートアリシアンは4要素、最深2代だった。
5. 既存coverageは辞書照合率であり、血統表の完全性ではない。コートアリシアンはcoverage 0.77でhighになっていたが、完全4代ではないため、Evidence v2ではConfidence Dとする。
6. `data/master/bloodlines.json` は承認済み集計だが、統計ごとのas-of日付を保持していない。バックテストでFuture Leakageを機械的に排除できないため、v2では統計をreference-onlyとし、スコアへ新規加算しない。
7. 父×母父、父系×母父系、クロス別の時点付き集計は未実装。未取得を中立点で埋めず `insufficient_sample` / `unavailable` とする。

## 今回の安全境界

- Blood Score、TM INDEX、既存weightは変更しない。
- `blood-features.mjs` で父×母父、取得完全性、クロス、component detail、Confidence、Evidenceを追加する。
- クロスは父側と母側の両方に同一祖先が存在するときだけ検出する。
- 統計の時点が証明できない間はEvidence表示のみとし、追加加点しない。
- 完全4代がない馬を「4代取得済み」と表示しない。

## 次工程

1. JV-Link UM/HNの繁殖登録番号を再帰解決し、30祖先の4代血統を標準入力にする。
2. raceDateをキーにした父・母父・配合・系統・クロス統計snapshotを生成する。
3. 階層FallbackとBayesian shrinkageをshadow scoreで検証する。
4. 旧Bloodとv2 shadow scoreを複数週で比較後、TM INDEX接続を判断する。
