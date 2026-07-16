# TURF MATRIX 週次自動更新パイプライン 設計書 v1.0

対象読者: Codex(実装AI) / 作成: CTO / 前提: **コードは書かない。この文書だけで実装可能にする**
最上位の制約: **毎週の人間の運用時間 30分以内**。破綻しない設計 > 高機能。

---

## 0. 現状資産と本設計の関係(Codexは必ず先に読むこと)

このリポジトリには**すでに動くパイプラインの大半が存在する**。ゼロから書かず、以下を再利用・分割せよ。

| 既存ファイル | 内容 | 本設計での扱い |
|---|---|---|
| `tools/csv-to-week.mjs` | TARGET CSV→week-data変換(プロファイル解析/文字コード自動判別/調教分類/血統/factors/EV/検証/ログ) | **中核として温存**。`tools/lib/` へ関数分割し、オーケストレータから呼ぶ |
| `tools/update-data.mjs` | JSONを`src/App.jsx`のマーカー間へ注入 | **廃止**(§2の移行後は不要。1リリース分はrollback用に残す) |
| `tools/lib-validate.mjs` | スキーマ検証(生成側/注入側で共用) | 温存・拡張(§6) |
| `tools/target-mapping.json` | 列名エイリアス+ヘッダー無しプロファイル定義 | 温存 |
| `src/App.jsx` | UI+ロジック+`WEEK_DATA:BEGIN/END`マーカー間のデータ | **データ部分を外出し**(§2)。UIコンポーネントは原則触らない |
| `docs/OPERATIONS.md` | 運営マニュアル | 本設計反映後に更新 |

既存の設計思想(維持必須): 人気順AI禁止・期待値中心 / 未取得データは`null`または`status:"未取得"`(ダミー生成禁止) / 検証エラー時は出力しない / エラーは`conversion-log.txt`に馬番単位で出す。

---

## 1. 全体アーキテクチャ

```
JRA-VAN TARGET (人間: CSV出力 ≦10分)
   ↓  data/target/ に置くだけ(ファイル名規約で自動認識 §6)
[import:target 1コマンド]
   ├─ tools/lib/parse-target.mjs      CSV読込(SJIS/UTF-8自動)・プロファイル/ヘッダー両対応
   ├─ tools/lib/normalize.mjs         馬名/レース名/日付/時刻の正規化(§6)
   ├─ tools/lib/factors.mjs           analysis.factors 自動生成(§7)・Training AI(§8)
   ├─ tools/lib/select-featured.mjs   featuredRace選択(§4)・raceType判定(§5)
   ├─ tools/lib/validate.mjs          スキーマ検証(既存lib-validate拡張)
   └─ 出力: src/data/week-data.json + conversion-log.txt + llm-enrich-prompt.txt
   ↓
Frontend: src/App.jsx が `import weekData from "./data/week-data.json"` で表示
   ↓
git push → Vercel 自動デプロイ
```

原則: **人間が触るのは data/target/ と(任意で)supplement.csv だけ**。コード・UIは毎週不変。

---

## 2. ディレクトリ構成(確定案)

```
data/
  target/                  # 毎週のTARGET CSV置き場。★.gitignore必須(§11-R0)
    shutuba*.csv           # 出馬表(ヘッダー無し46列プロファイル or ヘッダー付き)
    training*.csv          # 調教(累計列)
    pedigree*.csv          # 血統(任意。出馬表に含まれるなら不要)
    odds*.csv              # オッズ(任意・直前上書き用)
    supplement.csv         # 馬名/騎手/オッズ補完(ヘッダー無し運用時のみ)
    week-config.json       # 今週の開催情報(date/レース名/発走/馬場) §6-4
  master/                  # 週をまたいで育てるマスタ(git管理)
    stables.json           # 主要厩舎の勝負調教パターンDB §8
    courses.json           # コース特性DB(場×距離×芝ダ→特徴文・傾向) §7
    race-aliases.json      # レース名表記揺れ辞書 §11-R3
    grade-races.json       # 重賞カレンダー(名称→格。特別判定の補助) §5
tools/
  import-target.mjs        # ★新規: オーケストレータ(唯一の入口)
  lib/                     # 既存csv-to-week.mjsを機能分割(挙動は変えない)
    parse-target.mjs / normalize.mjs / factors.mjs /
    training-ai.mjs / select-featured.mjs / validate.mjs
  target-mapping.json      # 既存
src/
  data/week-data.json      # ★生成物(git管理・フロントが直接import)
  App.jsx                  # WEEK_DATAマーカー方式を廃止し上記をimport
docs/DESIGN-weekly-automation.md  # 本書
```

**移行タスク(最重要・最初にやる)**: `src/App.jsx`の`WEEK_DATA:BEGIN〜END`間の定数を削除し、`import WEEK_DATA from "./data/week-data.json"`へ置換。初回は現マーカー間JSONをそのまま`src/data/week-data.json`として切り出す。効果: 注入失敗というバグクラスの消滅、週次diffがJSONのみになりレビュー可能、UI破壊リスクの構造的低減。

---

## 3. week-data.json 理想構造(schemaVersion 4)

v3(現行)からの**追加のみ**(後方互換。UIの既読フィールドは削除・改名しない)。

```jsonc
{
  "meta": {
    "date": "2026-07-12", "dateLabel": "7月12日(日)", "week": "2026-W28",
    "venue": "福島・小倉", "updatedAt": "08:10",
    "schemaVersion": 4, "brand": "TURF MATRIX",
    "featuredRaceId": "fukushima-11",            // ★選択結果(§4)
    "generator": { "tool": "import-target", "version": "2.0", "inputs": ["shutuba_0712.csv", "..."] },
    "oddsUpdatedAt": "07/12 09:30",              // 取得できた場合のみ
    "textMode": "template | edited"
  },
  "dailySummary": { "text": "...", "highlights": ["..."] },
  "races": [{
    "id": "fukushima-11", "track": "福島", "number": 11,
    "name": "七夕賞", "raceType": "重賞",         // ★ "重賞" | "特別" | "一般" (§5)
    "grade": "GⅢ",                                // 重賞のみ。特別は省略(またはL)
    "date": "2026-07-12", "time": "15:45",        // ★race単位のdate必須化(複数日開催対応)
    "surface": "芝", "distance": 2000, "going": "良", "fieldSize": 16,
    "horses": [{
      "id": "fukushima11-01", "number": 1, "name": "...", "jockey": "...",
      "popularity": 3, "odds": 6.4, "aiScore": 82, "comment": "...",
      "topSignal": {                               // ★この馬の最重要シグナル1つ(§7-4)
        "type": "value|training|blood|course|ability",
        "text": "指数3位に対して7人気。期待値1.28"
      },
      "analysis": {
        "tags": [], "factors": { /* 現行9キーの数値。UI互換のため不変 */ },
        "factorsDetail": {                          // ★factorごとの根拠(§7)。UIは後追い対応
          "ability":  { "score": 84, "confidence": "high", "reason": "スピード指数のレース内正規化", "signals": ["指数127はメンバー首位"] },
          "training": { "score": 87, "confidence": "high", "reason": "一週前坂路4F51.3-1F11.9(加速)", "signals": ["加速ラップ", "乗り込み3本"] }
          /* course/distance/pace/value/blood 同型 */
        },
        "insight": ["3行"], "pros": [], "cons": [], "commentary": "...",
        "frameEval": {}, "trainingEval": {},        // 現行構造を維持
        "pedigree": { "lines": [4本], "scores": {9項目} },
        "confidence": "high|mid|low", "confidenceReasons": [],
        "crossAnalysis": { /* 現行5スロット。status: ok|部分|未取得 */ }
      },
      "raw": { /* 現行v3のまま: weight/horseWeight/intervalWeeks/pastRuns/trainingSessions/review */ }
    }]
  }],
  "featured": [ { "horseId": "...", "raceId": "...", "note": "..." } ]  // 注目馬3頭(現行)
}
```

方針: `factors`(フラット数値)は**UIが今読んでいるので絶対に維持**。新情報は`factorsDetail`/`topSignal`/`raceType`/`meta.featuredRaceId`として**足す**。validateは追加キーを無視する実装なので既存検証は通る。

---

## 4. featuredRace 自動選択ルール(select-featured.mjs)

決定的アルゴリズム(乱数・LLM禁止):

1. 候補 = races[] 全件。各レースに `priority` を付与: GⅠ=1, GⅡ=2, GⅢ=3, 特別=4, 一般=5(raceType/gradeから)。
2. 最小priority群に絞る(例: GⅢが1つでもあれば特別以下は候補外)。
3. 同priority複数 → `datetime = date + time`(JST)を組み、**import実行時刻以降で最も近いもの**。
4. 実行時刻以降が無い(全て発走済み) → **直近過去**(datetime最大)を選ぶ。
5. 結果を `meta.featuredRaceId` に書き、`dailySummary`/`featured`(注目3頭)の対象レースも同レース優先で選定。
6. ログに `[INFO] featuredRace: 福島11R 七夕賞(GⅢ, 優先度3, 発走15:45)` を必ず出す。

注意: 静的ビルドなので「現在時刻」は**生成時に固定**される。土曜生成→日曜メインを出すのが正: 3の比較は正しく日曜レースを選ぶ。UI側での再計算はしない(不要な複雑化)。

Hero/Race Card/BottomSheetは既にweek-dataだけで描画されるため、**UI変更は「Heroの主役レース=featuredRaceIdを参照する」1点のみ**(現状はraces[0]相当。App.jsx内の該当箇所を`meta.featuredRaceId`参照に変更)。

---

## 5. 特別レース対応

**判定ロジック(normalize時に raceType を決定)**:

1. `grade`列/レース名に GⅠ/GⅡ/GⅢ(G1/G2/G3, Ⅰ〜Ⅲ全角半角) → `重賞` + grade正規化。
2. `data/master/grade-races.json`(重賞名→格の辞書。年1回更新)に名称一致 → `重賞`(CSVに格が無い保険)。
3. クラス名に `L`/`リステッド`/`オープン`/`OP` → `特別`(Lは`grade:"L"`を付与可)。
4. レース名が `/(特別|賞|ステークス|S|Ｓ|カップ|C)$/` にマッチし1-3非該当 → `特別`。
5. それ以外(1勝/2勝/3勝クラス・未勝利・新馬で固有名なし) → `一般`。

**扱いの違い**: データ構造は完全に同一(分析の質を落とさない)。違いは表示優先度とfeatured候補順位のみ。

**UI表示**(最小変更):
- 重賞: 既存の青枠グレードバッジ(GⅢ等) — 実装済み、変更なし。
- 特別: 同じ位置に**枠線グレーの「特別」バッジ**(Lは「L」)。バッジ文字列はデータの`raceType`/`grade`から出す=UIロジック追加は条件分岐1つ。
- 一覧範囲: **重賞+特別のみ表示、一般は生成もしない**(β方針。import時にraceType=一般を除外し、除外数をログへ)。1開催週の想定表示数は2〜5レース。既存Race Cardグリッドは3列なので5件まで自然に収まる。

---

## 6. TARGET CSV import設計

**6-1. 必要CSVと必須項目**

| ファイル(命名規約) | 必須 | 必須項目 | 欠落時 |
|---|---|---|---|
| `shutuba*.csv` | ★必須 | レースキー(場/日付/R/馬番) or 場+R+馬番列、距離、頭数、指数 or 前走着順、人気 or オッズ | 生成中止(ERROR) |
| `supplement.csv` | ヘッダー無し運用時★ | 馬名・単勝オッズ(騎手・人気・脚質は推奨) | 馬名→プレースホルダ+WARN / オッズ→中止(--forceで概算) |
| `training*.csv` | 推奨 | 馬名(or キー)、調教日、コース、累計 | trainingEval=未取得(既存挙動) |
| `pedigree*.csv` | 推奨 | 馬名、父・母・母父・母の母 | pedigree lines=(未取得) |
| `odds*.csv` | 任意 | キー、単勝オッズ、(取得時刻) | supplementの値を使用 |
| `week-config.json` | ★必須 | 開催date、races[]: {track,raceNo,name,time,going,(grade)} | 生成中止(ERROR) |

**ファイル検出**: `data/target/` を走査し、上記グロブで自動割当(現行csv-config.jsonの手編集を廃止)。同名複数は更新日時の新しい方+WARN。想定外のCSVは先頭2行をログにダンプして無視。

**6-2. 文字化け対策**: 既存実装を踏襲(BOM→UTF-8→置換文字検出でShift_JIS(CP932)にフォールバック)。両方失敗時はファイル名と先頭バイト16進をログに出しERROR。

**6-3. 正規化(normalize.mjs)** — JOIN失敗の主因を潰す:
- 馬名: 全角/半角スペース除去、頭の `*`/`＊`(外国産マーク)除去した照合キーを別途持つ(表示は原文)、全角英数→半角。
- レース名: トリム、`Ｓ`→`ステークス`等は**しない**(表示は原文)。照合のみ `race-aliases.json` で吸収(例:「七夕賞」「たなばた賞」)。
- 日付: `YYYY/M/D`・`YYYYMMDD`・`M月D日`→ISO。**曜日整合チェック**(dateLabelの曜日とDateの曜日が食い違えばERROR)。
- 発走時刻: `H:MM`/`HHMM`/全角→`HH:MM`。範囲09:00〜17:00外はWARN。
- 数値: 全角→半角、カンマ除去(既存)。

**6-4. week-config.json**(旧csv-config.jsonのraces/meta部を継承・簡素化):
```jsonc
{ "date": "2026-07-12",
  "races": [
    { "track": "福島", "raceNo": 11, "name": "七夕賞", "grade": "GⅢ", "time": "15:45", "going": "良" },
    { "track": "福島", "raceNo": 10, "name": "織姫賞", "time": "15:10", "going": "良" }
  ] }
```
ヘッダー付きCSVがレース名/発走を含む場合はCSV優先・configは上書きのみ(空でも動く)に。**毎週人間が編集するのは実質このファイルとCSV配置だけ**。

---

## 7. analysis.factors 自動生成の土台(factors.mjs)

対象7 factor(既存9キーとの対応: value=EV系は既存crossAnalysis/ValueCard、bloodはpedigree系)。各factorは `factorsDetail.{key} = { score:0-100, confidence:"high|mid|low", reason:一文, signals:[短文0-3] }` を必ず出力し、フラット`factors`には従来どおりscoreのみ写す。

| factor | 入力 | スコア方針(既存実装ベース) | confidence基準 |
|---|---|---|---|
| ability | TARGETスピード指数(第一)、無ければ前走着順+着差 | レース内順位を92-56に正規化(既存) | 指数あり=high / 前走推定=mid / 無し=low |
| course | 過去走の同コースコード数、芝ダ一致、`courses.json`の特性適合 | 66+同コース×6+一致補正(既存)。courses.jsonの「求められる資質」と血統/脚質の合致で±4 | 同コース経験≥2=high / 0=low |
| distance | 過去走距離の最小差・同距離数 | 84−距離差/200×5+同距離×1.5(既存) | 同距離経験≥2=high |
| pace | 脚質、枠、頭数、(将来)メンバー全体の脚質分布 | 脚質基準値+内枠先行補正(既存)。脚質未取得=中立70+低confidence | 脚質あり=mid以上 / 無し=low |
| value | aiScore→推定勝率×オッズ | EV(既存式k=7)。scoreは min(99, EV×50) | オッズ実測=high / 概算=low |
| training | trainingSessions(§8) | Training AI(§8)の出力をそのまま | §8に従う |
| blood | 父/母父の系統テーブル、pedigree.scores | 9項目平均(既存)+種牡馬適性補正(既存) | 血統取得済=high / 未取得=low |

**7-2. reason/signalsの生成規則**: 全てテンプレート+実測値の埋め込み(例: `一週前坂路4F51.3-1F11.9(加速)`)。**形容だけの文言禁止**(「良い動き」単独はNG、必ず数値根拠を伴う)。データ未取得のfactorは `score=中立値, confidence:"low", reason:"◯◯データ未取得", signals:[]`。

**7-3. courses.json スキーマ**: `{ "小倉-芝-1200": { "traits": "下り坂スタートでテンが速い。直線約293mの前有利", "keyFactor": ["speed","pace"], "bias": "前・内" }, ... }`。七夕賞週の必須シードは**福島の芝1200/1800/2000とダ1150/1700**。無いキーは traits省略で動作(commentaryが汎用文になるだけ)。

**7-4. topSignal 選択規則**(馬ごとに1つ、決定的): 優先順 ①value(EV≥1.3) ②training(grade A かつ加速) ③blood(スプリント/コース系統合致 かつ 血統指数≥85) ④course(同コース≥3走) ⑤ability(指数レース1-2位)。該当なし→ `{type:"ability", text:"TM INDEX ◯位"}`。

---

## 8. Training AI 設計(training-ai.mjs) — 3段階

**Stage 1: 共通ロジック(実装済み+今回1点強化)**
- 既存: 累計→4F/Lap算出、最終(≤4日)/一週前(5-12日)/中間分類、窓内最速代表、コース別1F基準、加速ラップ、本数、休み明けcap。
- 強化(今回): **同週相対評価** — 同じimport内の全出走馬の一週前代表を(コース種別ごとに)時計順位づけし、上位20%に`signals:"今週の追い切り上位"`を付与。絶対時計の馬場差を吸収する最も安い手。

**Stage 2: 主要厩舎DB(data/master/stables.json)** — 今回スキーマとエンジンを実装、中身は少数シード
```jsonc
{ "schemaVersion": 1,
  "stables": [{
    "name": "中内田充正", "trainingCenter": "栗東",
    "pattern": { "phase": "一週前", "course": "CW", "time4FMax": 52.5, "last1FMax": 11.8, "accel": true },
    "note": "一週前CWで併せて時計を出すのが勝負仕上げ", "source": "manual", "confidence": "high"
  }] }
```
- 判定エンジン: patternの各条件(phase/course部分一致/time4FMax/last1FMax/accel/minCount)をsessionsに対しANDで評価 → `trainingEval.stablePattern = { match, status:"照合済", text: noteベースの実測文 }`。
- **DB未登録厩舎**: `status:"DB未登録"` とし、matchはStage1の仮判定(A/B→合致)を継続表示(文言に「仮判定」明記)。**全厩舎手入力はしない**。登録は「featuredRaceに出てきた厩舎だけ週2-3件ずつ追記」する運用ルールにする(30分枠の外・任意)。初期シードは0件でも動く設計にすること(空配列で全馬DB未登録)。
- 調教師名の取得: supplement/出馬表に調教師列があれば使用、無ければ全馬DB未登録として動く。

**Stage 3: AI抽出(将来・今回は器だけ)**
- 前提データ: `raw.review`(着順/払戻)の週次アーカイブ。今回、import時に `data/archive/YYYY-Www.json` として week-data 全体を自動保存する処理だけ実装(蓄積開始が全て)。
- 将来: アーカイブ横断で「厩舎×好走時のsessionsパターン」を統計/LLMで抽出→`stables.json`への**追記提案ファイル**を生成し人間が承認してcommit(自動書き換え禁止)。本設計では仕様として記すのみ、実装しない。

---

## 9. 毎週の運用フロー

**最小運用(目標25分)**
1. TARGET更新→CSV出力→`data/target/`へ配置(±10分)
2. `data/target/week-config.json` の日付・レース名・発走を更新(3分)
3. `npm run import:target`(1分。検証NGならログの馬番リストを見てCSV/補完を修正→再実行)
4. サイトをローカル`npm run dev`で30秒眺める+(任意)LLMで文章enrich(0-10分)
5. `git add -A && git commit && git push`(1分)→Vercel自動デプロイ

**理想運用(次フェーズ)**: GitHub Actions `workflow_dispatch`+`data/target/**`のpushトリガで import:target→`src/data/week-data.json`をbot commit→Vercel。※data/target/はgitignore方針(§11-R0)と矛盾するため、Actions化する場合はCSVを**privateリポジトリ or Actionsのartifact/手動アップロード**に置く前提で設計する(publicリポジトリにCSVを積まない)。βでは手動pushで十分。

---

## 10. 七夕賞までの最小実装(6日間・優先順)

| Day | タスク | 完了条件 |
|---|---|---|
| 1 | **P0** §2移行: week-data外出し+JSON import化、update-data廃止 | 現行北九州データのままビルド・表示が完全一致 |
| 1-2 | **P0** `import-target.mjs`(オーケストレータ+ファイル名規約検出+week-config) | 北九州CSV一式を`data/target/`に置き1コマンドで同一JSONを再生成できる |
| 2 | **P0** raceType判定(§5)+複数レース対応の確認(既存はマルチレース対応済み) | 疑似2レース入力で重賞+特別が正しく分類・表示 |
| 3 | **P0** featuredRace selector(§4)+App.jsxのHero参照1点変更 | featuredRaceIdのレースがHeroに出る |
| 3 | **P1** 特別バッジ表示(条件分岐1つ) / 一般レース除外 | 特別レースにグレー枠バッジ |
| 4 | **P1** factorsDetail+topSignal生成(§7。UI表示は不要、データのみ) / courses.json福島シード | validate拡張が通る |
| 4 | **P1** stables.jsonスキーマ+判定エンジン+アーカイブ保存(§8 Stage2器) | 空DBで全馬「DB未登録」表示、archiveに1ファイル生成 |
| 5 | **P0** 七夕賞+福島特別1-2鞍の実CSVで通しリハーサル→enrich→push | 本番URLで七夕賞が表示 |
| 6 | 予備日(CSV形式の揺れ対応・文言磨き) | — |

**後回し(実装禁止)**: 完全AI文章生成の自動実行 / 全厩舎DB / 有料化・認証 / GitHub Actions / UIの新コンポーネント追加。

---

## 11. リスクと対策

| # | リスク | 対策 |
|---|---|---|
| R0 | **JRA-VANデータの再配布**: TARGET生CSVをpublicリポジトリにcommitすると規約・権利上の問題 | `data/target/`と`data/archive/`を`.gitignore`。リポジトリに載るのは加工済みweek-data.jsonのみ。`raw.pastRuns`等の生値羅列も将来privateリポジトリ化 or 表示用フィールドへの縮約を検討(README注意書き必須) |
| R1 | CSV形式の揺れ(列順・列名・ヘッダー有無) | 既存: エイリアス表+プロファイル+検証。追加: 未知形式は先頭2行をログへダンプ、profiles追加だけで対応可能な構造を維持 |
| R2 | データ不足(血統/調教/オッズ欠落) | 既存の未取得ポリシー+supplementテンプレ自動生成+馬番単位ERROR。オッズ欠落は出力しない(--force概算はmeta明示) |
| R3 | レース名表記揺れ | race-aliases.json。featured選択はレース名でなく grade/raceType/日時で行う(名前依存を最小化) |
| R4 | 日付バグ | meta.date必須化+曜日整合チェック+「レース日が実行日±10日外」でWARN |
| R5 | 発走時刻バグ | HH:MM正規化+範囲チェック。featured比較はdate+timeで行い、time欠落時はdateのみ比較+WARN |
| R6 | UI破壊 | ①factorsフラット構造の凍結 ②lib-validate必須通過なしにweek-data.jsonを書かない ③import後に`vite build`をスモーク実行(package.jsonの`import:target`に`&& npm run build`は付けない — 代わりに`npm run verify`= validate+buildを用意し、運用手順に組込) ④schemaVersionチェック(App側は4未満でも動くが、生成側は4を明記) |
| R7 | 手作業増加 | supplement削減の恒久策=TARGETのヘッダー付き出力(項目名付加)への移行を運用側TODOに明記。stables.json登録は任意運用とし必須化しない |

---

## 12. Codex実装タスク一覧(Step by Step)

前提: 各Stepは独立コミット。**各Step完了時に `npm run build` が通り、表示が回帰しないこと**を受け入れ条件に含む。UIコンポーネントの見た目変更は Step7 のバッジ以外禁止。

1. **データ外出し**: `src/App.jsx`のマーカー間JSONを`src/data/week-data.json`へ切り出し、`import WEEK_DATA from "./data/week-data.json"`に置換。マーカーコメントと`validateWeekData`のモジュール時実行は残す(bannerは生かす)。受入: 表示が現行と完全一致。
2. **gitignore/雛形**: `data/target/`(+`.gitkeep`と`week-config.sample.json`)、`data/archive/`、`data/master/`(空の`stables.json`/`courses.json`/`race-aliases.json`/`grade-races.json`雛形)を作成。`data/target/*.csv`と`data/archive/`をgitignore。
3. **libへ分割**: `tools/csv-to-week.mjs`を挙動不変で`tools/lib/{parse-target,normalize,factors,training-ai,select-featured,validate}.mjs`へ分割(exportベース)。旧CLI互換は不要。受入: 北九州の入力から現行と同一のJSON(meta.updatedAt除く)が出るスナップショットテスト。
4. **オーケストレータ**: `tools/import-target.mjs`新規。`data/target/`走査→ファイル名規約割当→week-config読込→lib呼出→`src/data/week-data.json`書出→`data/archive/{week}.json`保存→ログ。`npm run import:target`と`npm run verify`(validate+vite build)をpackage.jsonへ。
5. **normalize強化**: §6-3(馬名照合キー、日付曜日整合、時刻正規化、race-aliases適用)。受入: 「＊プロトポロス」と「プロトポロス」がJOINする単体テスト。
6. **raceType判定+一般除外**: §5のルール実装。races[]に`raceType`と`date`を必ず付与。一般レースは除外し件数をログ。
7. **featured selector+UI2点**: §4実装で`meta.featuredRaceId`出力。App.jsx: Heroの主役レース参照をfeaturedRaceIdに変更/Race Cardバッジに`raceType==="特別"`のグレーバッジ分岐を追加。受入: 疑似データ(GⅢ+特別×2)でHeroがGⅢ、カードにバッジ。
8. **factorsDetail+topSignal**: §7の7 factor分のdetailとtopSignalを生成(UI変更なし)。lib-validateに「factorsDetailが存在する場合の型チェック(score範囲/confidence値/reason非空)」を追加(存在しなくてもエラーにしない)。
9. **Training AI Stage1強化+Stage2器**: 同週相対評価signal / stables.json判定エンジン(空DBで全馬「DB未登録」) / trainingEval.stablePatternのstatusフィールド追加。
10. **courses.json**: スキーマ実装+福島(芝1200/1800/2000, ダ1150/1700)と小倉既存分のシード。commentary/course factorがtraitsを参照(無ければ従来文)。
11. **ドキュメント**: docs/OPERATIONS.mdに新フロー(§9)を反映。README.mdの週次コマンドを`import:target`系へ更新。R0の注意書き追加。
12. **七夕賞リハーサル**: 実CSVで通し→conversion-logのERROR 0を確認→push。(データ入力は人間が行う。Codexはリハ用のダミーではなく**空のdata/targetで正しくERROR終了すること**を確認)

各Stepの共通Done定義: `npm run verify`成功 / conversion-logにERRORなし / 追加・変更ファイルが本書§2の構成に一致。

— 以上。判断に迷う箇所が出たら「30分運用を壊さない方」「ダミーを作らない方」「UIを触らない方」を選ぶこと。
