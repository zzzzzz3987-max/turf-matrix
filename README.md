# TURF MATRIX 運営マニュアル (β v0.3)

**TURF MATRIX — AI Racing Intelligence Platform**
ブランドコンセプト: 「競馬を、もっとクリアに。」感覚ではなく、データで競馬を読む。

AI競馬分析プラットフォーム TURF MATRIX の週次運営ドキュメントです。
**毎週の運営で触るのは `week-data.json` だけ**です。UIコードは触りません。

---

## 0. 構成と設計思想

```
JRA-VAN Data Lab. (TARGET frontier JV 経由)
        ↓  TARGETからCSV出力(§1-A)
CSV (出馬表/前走/血統/調教/オッズ ── 別々でも統合1本でもOK)
        ↓  node csv-to-week.mjs (読込→検証→変換、§1-B/C)
week-data.json (週次データ)
        ↓  (任意) LLMで文章を磨く(llm-enrich-prompt.txt)
        ↓  node update-data.mjs (検証 + 注入)
turfmetrics-beta.jsx (サイト本体)
        ↓
デプロイ
```

3層完全分離:

| 層 | 場所 | 毎週触るか |
|---|---|---|
| **DATA** | `week-data.json` / JSX内の `WEEK_DATA:BEGIN〜END` ブロック | **触る(ここだけ)** |
| **LOGIC** | JSX内 `[2] lib/logic`(期待値・勝率・Rank・血統指数・信頼度) | 触らない |
| **UI** | JSX内 `[5] components` `[6] pages` | 触らない |

### 自動計算される項目(JSONに書かない)

以下はサイト側ロジックが毎回計算するため、**手入力・手更新が不要**です:

- 単勝期待値(EV)・推定勝率・TM VALUE(期待値★1〜5)
- 指数の内訳(ファクター×重みの寄与と総合補正)
- 分析信頼度の★(レベル+調教評価から算出)
- レース内Rank(指数順位)
- S〜Dティア(TOP評価など)
- 血統指数(9項目の平均)
- レース単位の分析信頼度
- トップページの「分析レース数」「分析頭数」

### 分析ポリシー(データ作成時の必須ルール)

- **人気順の後追いは禁止。** aiScore は人気・オッズと独立に付ける
- 混戦(上位の指数が拮抗)なら、中位指数×高オッズの馬が自然にEV上位へ浮上する設計。
  指数を正直に付ければ、妙味の発見はロジック層が行う
- 調教は**一週前追い切りが主要評価**、最終追い切りは確認材料
- 血統は4ライン(父系・母父系・母母父系・牝系)+9項目評価

---

## 0.5 ブランドアセット(brand/)

| ファイル | 用途 |
|---|---|
| brand/logo.svg | 横長ロゴ(白背景用)。サイト・note・OGP・資料 |
| brand/logo-dark.svg | ダーク背景用(ネイビー地)。SNSヘッダー・名刺裏など |
| brand/logo-icon.svg | アイコン単体。ヘッダー・アプリ・PWA |
| brand/favicon.svg | 小サイズ最適化版(弧1本+頭部の簡略形) |
| brand/png/ | PNG書き出し一式(icon 32〜2048 / logo 1x・2x / dark / favicon 32・64) |

- カラー: Primary Navy `#0A1021` / Accent Teal `#00C2B8` / Highlight Emerald `#22E6A2` / Info Blue `#2D7BFF` / Gray `#6B7280`
- グラデーション: Teal → Blue → Emerald(`#00C2B8 → #2D7BFF → #22E6A2`)
- 白基調・黒背景禁止(logo-dark はダーク素材上での使用のみ)。黒×赤は使用しない
- ロゴ内テキストはフォント参照(Inter)のため、**印刷入稿時はアウトライン化を推奨**
- サイト側はヘッダーにアイコン+ワードマークをインラインSVGで組込済み(`tm-gradient-text` クラスがブランドグラデーション)

## 1. TARGET frontier JV → week-data.json パイプライン

毎週の運営フローは次の5手順で完結します:

```
① TARGET更新(データ取得)
② TARGETからCSV出力
③ node csv-to-week.mjs --config csv-config.json   … CSV読込→検証→JSON生成
④ (任意) LLMで文章を磨く                            … llm-enrich-prompt.txt を使用
⑤ node update-data.mjs && デプロイ                 … サイト更新
```

### 1-A. TARGETからCSVを書き出す方法

TARGETのCSV出力は大きく2系統あります。**どちらもこのパイプラインで取り込めます。**

**方式① 特定CSV形式(ヘッダー無し・数値のみ) — 現在の標準運用**
出馬表などの画面の出力メニューから出せる、列名行の無い固定レイアウトのCSVです。
本パイプラインには 46列の出馬表・特定CSV形式のプロファイル
(`target-shutuba-noheader-46`)が定義済みで、そのまま読み込めます。

- 列構造(解析済み): `[0]`レースキー10桁(場コード2/年2/回日2/R番号2/馬番2) / `[1]`コースコード / `[2]`距離 / `[3]`芝ダ(0=芝,1=ダ) / `[4]`頭数 / `[5]`スピード指数 / `[6]`出走間隔(週) / `[9]`人気 / `[10]`以降 過去7走×5列(コースコード, 距離, 芝ダ, 着差0.1秒単位, 予備)。過去走は左が新しい(前走)
- **注意: この形式には馬名・騎手・単勝オッズ・レース名・日付が含まれません。**
  レース名・発走・馬場・日付は `csv-config.json` の `races` / `meta` で指定し、
  馬名・騎手・オッズは自動生成される `supplement-template.csv` に貼り付けて補完します(§1-B)

**方式② ヘッダー付きCSV(推奨検討)**
TARGETには先頭行に項目名を付けて出力する設定(「項目名を付加する(CSV)」)や、
画面の表示内容をそのまま出す「画面イメージCSV形式」、出馬表分析画面の
「ユーザー形式CSV出力」(出力項目を自分で選択可能)があります。
馬名・騎手・単勝オッズを含むヘッダー付きで出力できれば、補完CSVが不要になり、
既存の列名マッピング(エイリアス照合)だけで取り込めるため**週次の手数が最少**です。
列名が想定と違う場合は `target-mapping.json` に列名を1つ追加するだけで対応できます。

> どちらを使うかの目安: 方式①は「毎回同じボタンで出る」再現性が強み(オッズと馬名だけ貼る手間あり)。
> 方式②は設定さえ済めば完全自動。まず①で運用開始し、②の出力設定が固まったら乗り換えるのが現実的です。

### 1-B. CSVを読み込む方法

1. CSVを任意のフォルダに置き、`csv-config.json` を作る(`samples/csv-config.sample.json` をコピーして編集):

```jsonc
{
  "files": [
    { "kind": "shutuba",  "path": "csv/shutuba.csv" },   // 必須(出走馬の軸)
    { "kind": "zenso",    "path": "csv/zenso.csv" },     // 以下は任意
    { "kind": "pedigree", "path": "csv/pedigree.csv" },
    { "kind": "training", "path": "csv/training.csv" },
    { "kind": "odds",     "path": "csv/odds.csv" }       // 出馬表のオッズを上書き(最新優先)
  ]
}
```

統合CSVなら `{ "kind": "unified", "path": "csv/all.csv" }` の1行だけでOK。
複数レース・複数場のCSVもそのまま入ります(場所+Rで自動グループ化)。

**ヘッダー無しCSV(特定CSV形式)の場合**は `profile` を指定し、CSVに含まれない情報を `races` / `meta` で補います:

```jsonc
{
  "meta": { "date": "2026-08-16" },
  "races": [
    { "track": "小倉", "raceNo": 11, "name": "北九州記念", "grade": "GⅢ", "time": "15:35", "going": "良" }
  ],
  "files": [
    { "kind": "shutuba", "path": "北九州記念.csv", "profile": "target-shutuba-noheader-46" },
    { "kind": "supplement", "path": "supplement.csv" }
  ]
}
```

**馬名・騎手・単勝オッズが入力に無い場合**、初回実行時に `supplement-template.csv` が自動生成され、処理は安全に停止します。テンプレートは初心者向けに以下の形式です:

```csv
# supplement.csv の書き方(この#で始まる2行は消さなくてOK。読み込み時に自動で無視されます)
# TARGETの出馬表を見ながら 馬名・騎手・単勝オッズ(例: 3.2)・人気(例: 1) を入力。場所/R/馬番は変更しないでください。
場所,R,馬番,馬名,騎手,単勝オッズ,人気
小倉,11,1,,,,10
小倉,11,2,,,,8
```

- `場所 / R / 馬番 / 人気` は**プレ入力済み**(人気はCSVから取得)。入力するのは基本 **馬名・騎手・単勝オッズの3つ**だけ
- `#` で始まる行は説明用コメントで、読み込み時に無視されます(消しても可)
- 任意で `脚質` 列(逃げ/先行/差し/追込)を追加すると展開スコアの精度が上がります
- **未入力の馬が残っている場合**、`conversion-log.txt` に
  `[ERROR] 小倉11R: 単勝オッズが未入力の馬番 → 3, 7, 12 (全13頭中 3頭)` の形式で、
  レースごと・馬番単位で不足箇所が出力されます
- `--force` を付けると人気からの概算オッズでドラフトを出力できます。その場合
  `meta.oddsApproximated: true` と `meta.oddsNote: "単勝オッズは人気からの概算値です(参考表示)"`
  が付与され、画面側が将来このフラグを読んで「オッズ概算」表示を出せます(現UIは未対応・データのみ)

2. **列名がTARGETの設定と合わない場合**は、`target-mapping.json` の該当フィールドに列名を追加するだけで対応できます(コード変更不要)。照合は空白除去・全角英数の半角化のうえ完全一致です。

3. CSV同士の紐づけ(JOIN)は「場所+R+馬番」を優先し、無ければ「馬名」で行います。紐づかない行は警告ログに出て無視されます。

### 1-C. week-data.json の生成方法

```bash
node csv-to-week.mjs --config csv-config.json
# 生成物: week-data.json / conversion-log.txt / llm-enrich-prompt.txt
# 続けて反映:
node update-data.mjs week-data.json turfmetrics-beta.jsx
```

- 検証エラーがあると **JSONは出力されず**、`conversion-log.txt` に `[ERROR]` として一覧されます(`--force` でドラフト出力可)
- `[WARN]` は出力はされるが確認推奨(例: 血統列の不足、人気列をオッズから導出、など)
- オッズCSVに「取得時刻」があれば `meta.oddsUpdatedAt` に記録されます

### 1-D. スコアの算出ロジック(決定的・AI不使用)

| フィールド | 算出方法 |
|---|---|
| ability | スピード指数のレース内順位を92〜56に正規化。指数列が無ければ前走着順・着差から簡易推定(WARNログ) |
| course / distance | 前走の場所・芝ダ・距離と今回条件の一致度 |
| pace | 脚質(逃80/先78/差72/追66)+内枠先行ボーナス |
| lap | 前走上り3F(ダートは基準緩和) |
| training / trainingLap | 調教評価(A〜E)または一週前の時計・終い1F |
| stable | 中立帯68±(厩舎成績は未接続。接続後に置換予定) |
| frame | 馬番の内/中/外 |
| aiScore | 上記+血統指数の**重み付き合計**(UIの「指数の内訳」と同一の重み。内訳とほぼ完全に一致します) |
| EV / 勝率 / Rank / ティア | サイト側と同一式で自動計算 |

**人気・オッズは aiScore の算出に一切使いません**(分析ポリシー準拠)。

### 1-E. 文章の品質(2段階)

- **テンプレートモード(既定)**: CSVの事実(前走・調教時計・脚質・枠)から文章を自動生成。そのまま公開できる「縮退運転」品質で、自動生成である旨の注記が入ります
- **LLM磨き上げ(任意)**: 生成される `llm-enrich-prompt.txt` と `week-data.json` を**任意のLLM**(Claude / 他社モデル / ローカルLLM)に渡すと、数値を変えずに文章だけを具体化したJSONが得られます。特定モデル専用の手順はありません

### 1-F. 今日の公開手順(北九州記念11R・46列CSV+supplement方式)

```bash
cd samples/kitakyushu
# 1. TARGETの出馬表を見ながら supplement.csv の 馬名・騎手・単勝オッズ を実際の値に書き換える
#    (現在入っている「サンプル馬01」等はダミーです。場所/R/馬番/人気はそのままでOK)
# 2. csv-config.json の meta.date / races[].time / going を当日の値に確認・修正
# 3. 変換(検証エラーがあれば conversion-log.txt に馬番単位で出ます)
node ../../csv-to-week.mjs --config csv-config.json --out week-data.kitakyushu.json
# 4. (任意) llm-enrich-prompt.txt + 生成JSONを任意のLLMに渡して文章を磨く
# 5. サイトへ注入してデプロイ
node ../../update-data.mjs week-data.kitakyushu.json ../../turfmetrics-beta.jsx
```

> Claudeだけで運営する場合: このリポジトリ一式とCSVをClaudeに渡し「csv-to-week.mjs を実行して文章を磨いて」と依頼すれば③〜④が一度に完了します。スクリプト自体はAI無しでも動くため、どちらの運営体制にも切り替え可能です。

## 2. 毎週の更新手順

### 方法A: スクリプト(推奨・約1分)

```bash
# 1. week-data.json を今週の内容に差し替える(作り方は §1 のパイプライン、または §6 のプロンプト)
# 2. 検証+注入(エラーがあれば反映されず一覧表示される)
node update-data.mjs week-data.json turfmetrics-beta.jsx
# 3. デプロイ
```

### 方法B: 手動貼り付け(スクリプトが使えない環境)

1. `turfmetrics-beta.jsx` を開き、次の2つのマーカーを探す
   ```
   /* ===== WEEK_DATA:BEGIN (このブロックを差し替え) ===== */
   /* ===== WEEK_DATA:END ===== */
   ```
2. マーカーの**間**を `const WEEK_DATA = { …今週のJSON… };` に丸ごと置き換える
3. 保存してデプロイ。データに不備があると画面上部に警告バナーが出ます(詳細はブラウザのコンソール)

> 週替わりチェックリスト:
> `meta.date / dateLabel / week / updatedAt` を更新 →
> `races` を今週分に → `dailySummary` を更新 → `featured` の3頭を今週の馬IDに

---

## 3. week-data.json のスキーマ

```jsonc
{
  "meta": {
    "date": "2026-07-03",        // 必須
    "dateLabel": "7月3日(金)",   // ヘッダー表示用
    "venue": "東京",
    "updatedAt": "08:00",
    "version": "β v0.3",
    "schemaVersion": 2,
    "week": "2026-W27"
  },
  "dailySummary": {
    "text": "本日の傾向…(2〜3文)",
    "highlights": ["箇条書き1", "箇条書き2", "箇条書き3"]
  },
  "races": [ /* Race(§3.1) */ ],
  "featured": [                   // 注目馬3頭(PICK 01/02/03の順)
    { "horseId": "t11-02", "raceId": "tokyo-11", "note": "一言(30字前後)" }
  ]
}
```

### 3.1 Race

| フィールド | 型 | 備考 |
|---|---|---|
| id | string | 一意。例 `tokyo-11` |
| track / number / name | string / number / string | |
| grade | string(任意) | `"GⅠ"` `"GⅡ"` `"GⅢ"`。重賞のみ。青枠バッジで特別表示 |
| time / surface / going | string | `"15:40"` / `"芝"` or `"ダート"` / `"良"` など |
| distance / fieldSize | number | **fieldSize は horses の要素数と一致必須**(スクリプトが検証) |
| horses | Horse[] | |

### 3.2 Horse

```jsonc
{
  "id": "t11-02",              // 全レース通して一意
  "number": 2,                  // 馬番
  "name": "ステラウェイヴ",
  "jockey": "高村 圭",
  "popularity": 1,              // 人気
  "odds": 2.9,                  // 単勝オッズ(EV計算に使用)
  "aiScore": 94,                // 総合AI指数 0-100。人気と独立に付けること
  "comment": "短評(25字前後)",
  "analysis": { /* §3.3 */ }
}
```

### 3.3 Analysis

```jsonc
{
  "tags": ["先行力", "距離適性◎"],           // 2〜4個
  "factors": {                                 // すべて0-100・必須(9キー)
    "ability": 94, "course": 88, "distance": 92,
    "pace": 86, "lap": 90,
    "training": 88, "trainingLap": 91,
    "stable": 85, "frame": 82
  },                                           // course=コース適性 / pace=展開適性
  "insight": ["最重要1", "最重要2", "最重要3"], // AIが最も伝えたいこと3行
  "pros": ["プラス要因…"],                     // 1〜3個
  "cons": ["マイナス要因…"],                   // 1〜3個
  "commentary": "AI総評(100〜160字)",
  "frameEval": { "score": 82, "text": "枠順の評価コメント" },
  "trainingEval": {
    "grade": "A",                              // A/B/C/D
    "oneWeek": { "score": 91, "text": "…" },   // 一週前=主要評価
    "final": { "status": "良好", "text": "…" }, // 最終追い=確認材料
    "stablePattern": { "match": true, "text": "…" }
  },
  "pedigree": {                                // 4ライン分析
    "lines": [
      { "role": "父系",     "name": "…", "note": "系統の特徴" },
      { "role": "母父系",   "name": "…", "note": "補強点" },
      { "role": "母母父系", "name": "…", "note": "特徴" },
      { "role": "牝系",     "name": "…", "note": "近親傾向" }
    ],
    "scores": {                                // すべて0-100・必須
      "course": 87, "distance": 92, "going": 90, "lap": 89,
      "family": 90, "speed": 88, "stamina": 93, "burst": 85, "sustain": 92
    }
  },
  "confidence": "high",                        // high / mid / low
  "confidenceReasons": [                        // 信頼度の理由(2〜3件・必須)
    "近走4走分のデータが揃っている",
    "同コース・同条件の実績サンプルあり",
    "一週前追い切りの評価が明確"
  ]
}
```

---

## 4. 新レース・新馬の追加方法

### 新レース
`races` 配列に Race オブジェクトを1つ追加するだけ。UI(トップのカード・ランキング・統計)は自動で追従します。
最短の作り方: 既存レースをコピー → `id / track / number / name / time / surface / distance / going / fieldSize / horses` を書き換え。

### 新馬
対象レースの `horses` に Horse を1頭追加し、**そのレースの `fieldSize` を +1** する。
`id` は `t{レース番号}-{馬番2桁}` の命名を推奨(例: `t11-11`)。
Rank・EV・血統指数などは自動計算されるので追記不要。

### 注目馬(featured)の入れ替え
`featured` の `horseId / raceId / note` を差し替えるだけ。配列の順序が PICK 01→03 になります。

---

## 5. Data Lab. / API へ差し替える場所

差し替えポイントは2箇所だけです。

### (1) データ生成側(サイト外)
Data Lab. のCSV/JV-Data → `week-data.json` への変換。§6のプロンプトか自作スクリプトで行う。
**ここが週次運営の本体**で、サイト側は何も変わりません。

### (1.5) CSV→JSONの変換フロー(Data Lab. 接続ガイド)

```
Data Lab. クライアント(JV-Link等)からCSVエクスポート
  ↓
変換(方法は3択: §6のLLMプロンプト / 自作スクリプト / 手動)
  ↓ week-data.json
node update-data.mjs (検証。列の欠落・型ミスはここで全て検出)
```

CSV列とJSONフィールドの対応の目安:

| Data Lab. 系データ | JSONの行き先 |
|---|---|
| レース詳細(RA系: 開催・R番号・距離・馬場) | `races[].track / number / name / surface / distance / going / time` |
| 出走馬(SE系: 馬番・騎手・人気・オッズ) | `horses[].number / name / jockey / popularity / odds` |
| 調教(HC系: 追い切り時計・コース) | `analysis.trainingEval`(一週前=oneWeek、最終=final) |
| 血統(HN/BT系: 父・母父など) | `analysis.pedigree.lines`(4ライン) |
| 過去走・ラップ | `factors.ability / lap / pace` などスコア化の根拠 |

数値スコア(factors / pedigree.scores)への変換ロジックは自作スクリプトに寄せると
毎週の再現性が上がり、LLMには文章(insight/commentary/pros/cons)だけを任せる分業が理想です。

### (2) 将来API化する場合(サイト内)
JSX内 `[3] lib/dataProvider` の各関数の**中身だけ**を置換します(インターフェースは変更しない):

| 関数 | 現在 | API化後の例 |
|---|---|---|
| getMeta() | WEEK_DATAから返す | `fetch("/api/meta")` |
| getDailySummary() | 〃 | `fetch("/api/summary")` |
| getRaces() | 〃 + 信頼度計算 | `fetch("/api/races")` |
| getRace(id) | 〃 | `fetch("/api/races/" + id)` |
| getFeaturedHorses() | 〃 + EV計算 | `fetch("/api/featured")` |
| getIndexRanking(n) | 〃 | `fetch("/api/ranking?limit=" + n)` |

全関数がasyncのため、UI側の変更はゼロです。`simulateLatency` はAPI化時に削除してください。

---

## 5.5 TARGET完全連携ロードマップ(スキーマv3)

方針: **TARGETで取得できる情報をほぼすべてAI分析へ利用する**。β版で未取得の項目は生成せず、`null` または `status: "未取得"` として正直に扱う(スキーマv3で構造だけ先に確保済み)。

### データの置き場所(取得対象 → スキーマ)

| 分類 | 項目 | スキーマ上の位置 | 現状 |
|---|---|---|---|
| 基本 | 馬名/騎手/枠順/人気/単勝オッズ | horses[](既存) | ✅ 46列CSV+supplement |
| 基本 | 斤量/馬体重/増減 | raw.weight / raw.horseWeight / raw.weightDiff | 未取得(マッピング定義済み) |
| 近走 | 距離/芝ダ/着差 ×7走 | raw.pastRuns[] | ✅ 46列CSV |
| 近走 | 着順/通過/上がり/クラス/馬場/日付/指数 | raw.pastRuns[] の各null枠 | 未取得(枠のみ確保) |
| 血統 | 父/母/母父/母母父/父系/牝系 | analysis.pedigree.lines + raw | 未取得(接続で自動反映) |
| 調教 | 一週前/最終/中間・坂路/CW/W・時計/ラップ/本数/評価 | raw.trainingSessions[] + trainingEval | 未取得(枠のみ確保) |
| 馬体 | 出走間隔/休み明け | raw.intervalWeeks(+タグ自動付与) | ✅ 46列CSV |
| 回顧 | 着順/払戻/ラップ/ペース/上がり順位/回収率 | raw.review(レース確定後に充填) | 未取得(枠のみ確保) |

### クロス分析(複数ファクターの掛け合わせ)

単独表示ではなく組み合わせで使うため、`analysis.crossAnalysis` に5スロットを常設:

| スロット | 掛け合わせ | 現状 |
|---|---|---|
| indexXvalue | 指数 × 期待値(オッズ乖離) | ✅ 稼働中 |
| styleXpace | 脚質 × 展開(枠・ペース) | 脚質列の供給で稼働(supplementに脚質列を足すだけ) |
| trainingXfreshness | 調教 × 休み明け(間隔) | ✅ 稼働中(調教CSV接続済み) |
| pedigreeXcourse | 血統 × コース適性 | ✅ 稼働中(出馬表の血統列から) |
| goingXpedigree | 馬場 × 血統 | 馬場履歴+血統の接続で稼働 |

各スロットは `{ status: "ok" | "部分" | "未取得", score, note }`。データが繋がった瞬間に
`csv-to-week.mjs` が自動で "ok" に切り替える設計で、UI側は status を見て出し分けるだけです(UI実装は次フェーズ)。

### 調教データの自動分類(実装済み)

調教CSV(1追い切り=1行、45日分すべて)を渡すと、パーサがレース日から自動分類します:

- **最終追い切り** = レース4日以内 / **一週前追い切り** = 5〜12日前 / **中間調整** = 13日前以降
- 各窓は「実追い切り(終い14.5秒以内)のうち最速の1本」を代表として評価に採用
- `累計` 列(例 `53.7-38.6-24.7-12.2`)から 4F時計・終い1F・**Lap4〜Lap1** を自動算出
- 全セッションは `raw.trainingSessions[]`(date/course/time4F/last1F/laps/phase)に保持、**本数**は `trainingCount`
- 調教ファクター: コース別基準(坂路/CW)の終い1F + 加速ラップ + 乗り込み量で採点
- **レース日の指定が必須**(`races[].date` または `meta.date`)。無いと分類できず警告が出ます
- 長期休養明け(間隔16週以上)は信頼度を自動でmid止まりにし、理由に明記

### 接続の順序(推奨)

1. **脚質**(supplementに1列足すだけ → styleXpace稼働)
2. **血統**(TARGET血統CSV or 統合CSVの父/母父/母母父列 → pedigreeXcourse稼働、血統カードが実データ化)
3. **調教**(調教CSV → 一週前主要評価が実データ化、trainingXfreshness完全化)
4. **回顧**(レース確定後のCSV → raw.review充填、回収率の透明化ページへ)

## 6. LLMへ渡すプロンプト例(週次データ生成)

Data Lab. から出力した出走表・調教・血統・オッズのCSV(またはテキスト)を添付し、以下を渡します。
**Claude以外のLLMでもそのまま使えます。**

```
あなたは競馬AI分析サービス「turfmetrics」のデータ作成担当です。
添付の出馬表・調教・血統・オッズデータから、week-data.json を生成してください。

# 出力
- 有効なJSONのみを出力(コメント・前置き禁止)
- スキーマは添付の week-data.json サンプルに完全準拠
  (meta / dailySummary / races[] / featured[]、馬ごとに analysis 一式)

# 分析ルール(厳守)
1. 人気順の後追いは禁止。aiScore は人気・オッズと独立に、
   能力/展開/ラップ/血統/調教/コース/距離/馬場/相手関係から付ける
2. 期待値・勝率・Rank はサイト側で自動計算するため出力しない
3. 調教評価は一週前追い切りを主要評価に、最終追い切りは確認材料として書く
4. 厩舎の勝負調教パターンとの合致/非合致を必ず判定する
5. 血統は4ライン(父系/母父系/母母父系/牝系)+9項目スコア(0-100)
5b. factors にはコース適性(course)と展開適性(pace)も含める(9キー)
5c. confidence には必ず confidenceReasons(理由2〜3件)を添える
5d. commentary はコース形状・ラップ傾向・脚質・展開・枠順を具体的に絡めて書く
    (「好走可能です」のような一般論で終わらせない)
6. insight は「AIが今回最も伝えたいこと」を3行、各25字前後
7. commentary は100〜160字。断定を避け「〜と分析します」の距離感で
8. confidence: 初条件・サンプル不足は low、根拠が揃う馬は high
9. 的中や利益を保証する表現は禁止
10. featured は指数上位から2頭 + 妙味型(指数順位が人気より明確に上の馬)を1頭

# 対象
{開催日} {競馬場} {対象レース番号}
```

生成後は必ず `node update-data.mjs` を通してください(不備は反映前に検出されます)。

---

## 7. 特定AI無しで運営する方法

このプロジェクトに**AIが必須の箇所はありません**。依存を切る手段を強い順に:

1. **どのLLMでも代替可** — §6のプロンプトはモデル非依存。Claude Sonnet/Haiku、他社モデル、ローカルLLMでも同じJSONが作れます(検証スクリプトが品質の下限を担保)
2. **半自動** — 数値(factors/pedigree.scores)はData Lab.のデータから自作スクリプトで機械的に算出し、文章(insight/commentary等)だけLLMまたは手書きにする
3. **完全手動** — `week-data.json` をエディタで直接編集。既存週をコピーして書き換えれば、3レース分で60〜90分程度
4. **縮退運転** — 文章系(insight/commentary/pros/cons)を短文・定型文にすれば、手動でも30分程度まで短縮可能。UIは短文でも崩れません

サイト内のEV・勝率・Rank・ティア・血統指数・信頼度・統計値は**すべて決定的なロジック**(JSX内 `[2] lib/logic`)で、AIを一切使いません。

---

## 8. ファイル構成

```
turfmetrics-beta.jsx        … サイト本体(UI + LOGIC + 注入済みDATA)
week-data.json              … 週次データ(毎週これを差し替える)
csv-to-week.mjs             … TARGET CSV → week-data.json 変換(検証・ログ付き)
target-mapping.json         … CSV列名の対応表(列名の揺れはここで吸収)
update-data.mjs             … 検証+注入スクリプト
lib-validate.mjs            … スキーマ検証(csv-to-week / update-data 共通)
conversion-log.txt          … 変換ログ(csv-to-week 実行時に生成)
llm-enrich-prompt.txt       … 文章磨き上げ用プロンプト(csv-to-week が生成)
samples/                    … 動作確認用サンプルCSV一式と設定例
samples/kitakyushu/         … 実CSV(特定CSV形式・北九州記念)での実運用例一式
README.md                   … 本書
※すべて Node.js 18+ / 外部依存なし / 特定AIワークフロー非依存
```

## 9. トラブルシューティング

| 症状 | 対処 |
|---|---|
| 画面上部に黄色い警告バナー | データ不備。ブラウザのコンソールに欠落項目が一覧表示される |
| update-data.mjs が「検証エラー」で止まる | 表示された項目をJSONで修正。反映はされていないので安全 |
| 頭数が合わない | `fieldSize` と `horses` の数を一致させる |
| csv-to-week が「検証エラー」で止まる | conversion-log.txt の [ERROR] 行を修正(TARGETの出力項目 or target-mapping.json) |
| CSVの列が認識されない | target-mapping.json の該当フィールドにTARGET側の列名を追加 |
| ヘッダー無しCSV(数値のみ)を渡した | csv-config.json の files に "profile": "target-shutuba-noheader-46" を指定 |
| 「単勝オッズが未取得」で停止 | 自動生成された supplement-template.csv に馬名・オッズを貼り付けて supplement として追加 |
| 文字化けする | 自動判別対象はUTF-8/Shift_JIS。それ以外はUTF-8で書き出し直す |
| 前走/血統/調教が反映されない | 馬名の表記ゆれ(全角/半角スペース)を確認。JOINは場所+R+馬番が最優先 |
| ボトムシートが最後までスクロールしない | v0.2で対策済み(dvh + overscroll-contain + bodyロック)。再発時は `.tm-sheet` のCSSと BottomSheet のbodyロック処理を確認 |

## 10. バージョン履歴

- **pipeline v1.4**: TARGET実データ接続(血統: 父/母/母父/母の母 + 既知種牡馬の傾向・適性補正 / 調教: 累計→Lap自動算出・最終/一週前/中間の自動分類・本数保持・コース別採点) / 休み明け信頼度キャップ / 馬名JOIN索引の修正
- **pipeline v1.3 / brand v1**: TURF MATRIXへリブランド(ロゴSVG/PNG一式・サイト組込) / スキーマv3(raw生データ層・crossAnalysis 5スロット・未取得ポリシー) / 北九州記念を公開品質テキスト化
- **pipeline v1.2**: supplement初心者向けテンプレート(#説明行・人気プレ入力・7列) / 不足馬番のレース別ログ / --force時の meta.oddsNote 付与 / #コメント行の無視
- **pipeline v1.1**: TARGET特定CSV形式(ヘッダー無し46列)のプロファイル対応 / 補完テンプレート自動生成 / config によるレース情報指定 / 過去7走ベースのコース・距離スコアリング
- **v0.3 + pipeline v1**: TARGET frontier JV CSV→JSON変換パイプライン(csv-to-week.mjs / target-mapping.json / lib-validate.mjs / エラーログ / サンプルCSV)
- **v0.3**: ファクター比較テーブル / 指数の内訳表示 / 信頼度★+理由 / TM VALUE(期待値★)ブランド化 / factorsにcourse・pace追加 / confidenceReasons必須化
- **v0.2**: 3層分離(WEEK_DATAマーカー) / 期待値ロジック / 血統4ライン / ボトムシートスクロール修正
- **v0.1**: 初版

## 11. 将来メモ(β以降)

- Next.js化: `[1]〜[6]` の各区画をそのまま `lib/` `components/` `app/` に分割。WEEK_DATAは `data/week.json` をimport
- 過去分析ログ(検証・回顧・回収率の透明化): スキーマ予約済みの `RaceArchive` を使用。週次JSONをアーカイブフォルダに積むだけで履歴データになる設計
