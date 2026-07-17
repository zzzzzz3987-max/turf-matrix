# TURF MATRIX JV-Link 取得アプリ 設計書 v1.0

対象読者: Codex(実装AI) / 作成: CTO

位置づけ: 基盤設計書(`DESIGN-weekly-automation.md`)の入力側を置き換える第3の設計書。基盤設計書・Intelligence設計書は不変。本書は `data/target/` にCSVを置くまでの工程だけを自動化する。

## 0. 目的と到達点

現状: 毎週人間がTARGETを操作してCSVを出力・配置している(レース数に比例して作業増)。

到達点: `jvfetch.bat` を1回実行(またはタスクスケジューラ)すると、JRA-VANから直接データを取得し、既存パイプラインが読める形式のCSV一式が `data/target/` に生成される。

得られる効果:

- supplement工程の消滅: JV-Linkの出力には馬名・騎手・オッズが最初から含まれる。ヘッダー付きCSVとして出力するため、ヘッダー無し46列+supplementの補完運用が不要になる。
- レース数スケール: 重賞2+特別でも全レースでも、取得コストは同じ(人力ゼロ)。
- TARGET依存の縮小: 残る依存はスピード指数1ファイルのみ(§3-6)。これも将来Ability Engineの自前指数(Intelligence設計書§13-A)で置換し、完全自立する。

やらないこと(スコープ外): 指数の自前計算 / 過去数年分の一括取得(学習用アーカイブは別タスク) / Node側パイプラインの変更(出力形式を既存互換にすることで無変更を保証する)。

## 1. 全体アーキテクチャ

```text
JRA-VAN Data Lab.
   ↓ JV-Link (Windows COMコンポーネント / 契約認証済み環境)
tools/jvfetch/ (C# コンソールアプリ ★本書の実装対象)
   ↓ 出力: ヘッダー付きCSV + week-config.json 下書き
data/target/
   shutuba.csv / pedigree.csv / training.csv / odds.csv / week-config.json
   ↓ 既存: npm run import:target (無変更)
src/data/week-data.json → git push → Vercel
```

原則: `jvfetch`は「取得と整形」だけ。分析・正規化・検証は既存パイプラインの責務(混ぜない)。

`jvfetch`が失敗した週は、従来どおりTARGET手動出力で回る(手動フォールバック維持 — 基盤§9の思想)。

## 2. 技術選定と環境制約(Codexはここを読み違えないこと)

| 項目 | 決定 | 理由 |
|---|---|---|
| 言語/ランタイム | C# / .NET Framework 4.8 / コンソールアプリ | JV-LinkはCOMコンポーネント。COM相互運用の実績が最も安定 |
| プラットフォーム | x86(32bit)ビルド必須 | JV-Linkは32bit COM。AnyCPU(64bit実行)ではCreateObjectに失敗する。最頻出の躓きポイント |
| 実行環境 | Windows(TARGETが動いている本番機) | JV-Link/契約認証がその環境に既にある |
| 配置 | `tools/jvfetch/`(ソース) + `tools/jvfetch/bin/`(ビルド済みexe, gitignore) | リポジトリ同居。ただしexeとJRA-VAN由来データはcommitしない |
| COM参照 | JV-Link (JVDTLab) をCOM参照として追加 | ProgID等の正確な識別子はSDK同梱のJV-Link仕様書で確認すること(推測で書かない) |
| 呼び出しAPI | JVInit → JVOpen(蓄積系) / JVRTOpen(速報系) → JVReadループ → JVClose | JV-Link標準フロー |
| 文字コード | JV-Link出力はShift_JIS系 → CSVはUTF-8(BOM付き)で書き出す | 既存パイプラインは両対応だが、新規出力はUTF-8に統一 |

Codexへの必須指示: JV-Data仕様書(SDK/JRA-VAN公式配布のPDF・レコードフォーマット定義)を正とし、レコード型式のバイト位置・項目定義は必ず仕様書から転記する。本書の§3は「何を取るか」の指定であり、バイト位置は仕様書参照。推測でパースを書いてはならない。

## 3. 取得データ仕様(必要データ → JV-Dataレコード → 出力CSV)

表中のdataspec/レコード種別IDは代表値。SDK仕様書と食い違う場合は仕様書が正(その旨をREADMEに記録)。

### 3-1. 開催・レース情報(week-config下書きの材料)

レコード: RA(レース詳細)、YS(開催スケジュール)

取得範囲: 今週(対象開催日)のみ

出力: `week-config.draft.json` — date / 各レースの track・raceNo・レース名・grade(重賞コード)・発走時刻・芝ダ・距離。

going(馬場状態)は前日時点で未確定のため空欄とし、人間が当日確認して確定(基盤§6-4の運用のまま)。

既存`week-config.json`を上書きしない。draftを見て人間がリネーム採用する(誤爆防止)。

### 3-2. 出馬表(shutuba.csv)

レコード: SE(馬毎レース情報) + RA

出力列(既存`target-mapping.json`のエイリアスに一致させる):

```text
日付,場所,R,レース名,クラス,芝ダ,距離,発走,頭数,枠番,馬番,馬名,性齢,騎手,調教師,斤量,人気,単勝オッズ
```

人気・オッズはこの時点の暫定値(確定は§3-5の`odds.csv`が上書き)。

### 3-3. 血統(pedigree.csv)

レコード: UM(競走馬マスタ) + HN(繁殖馬マスタ)(3代血統の展開に使用)

出力列:

```text
馬名,父,母,母父,母の母
```

UM/HNの参照解決(繁殖登録番号→馬名)は`jvfetch`内で行い、CSVには名前で出す(既存互換)。

### 3-4. 調教(training.csv)

レコード: HC(坂路調教)。ウッド/CW系レコードが契約仕様に含まれる場合は同様に取得。

JV-Data仕様のバージョンにより有無が異なるため仕様書で確認。無ければ坂路のみで開始。

取得範囲: 対象出走馬 × 直近45日

出力列:

```text
馬名,調教日,調教コース,累計
```

累計は既存互換の `"53.7-38.6-24.7-12.2"` 形式に整形。

4F/ラップ算出は既存パイプラインの責務(`jvfetch`は整形のみ)。

### 3-5. オッズ(odds.csv)

レコード: 単勝オッズ(速報系 O1系 / JVRTOpen)

出力列:

```text
場所,R,馬番,馬名,単勝オッズ,人気,取得時刻
```

`--odds-only` モード(§5)で土曜昼〜夕方に単独再実行できること(直前オッズ更新の運用)。

### 3-6. スピード指数(スコープ外・運用注記)

JV-LinkにTARGETのスピード指数は存在しない(TARGET独自の計算値)。

当面: TARGETから指数CSV(既存46列 or 指数列入り出力)を1ファイルだけ手動出力して併置する。

`jvfetch`のREADMEに「指数はTARGET出力を継続使用中。Ability Engine自前化で廃止予定」と明記。

## 4. 出力仕様(既存パイプライン無変更の保証)

- すべてヘッダー付きCSV / UTF-8(BOM) / カンマ区切り。
- 列名は `tools/target-mapping.json` の既存エイリアスに一致させる。
- 新エイリアス追加が必要ならmapping側に追記し、その差分を報告する。Node側コード変更は禁止。
- 出力先は `data/target/`。
- 既存ファイルは上書き前に `data/target/_backup/{timestamp}/` へ退避。
- 取得0件のファイルは空CSVを書かない(存在しない=未取得として既存の縮退が働く)。
- 実行ログ: `data/target/jvfetch-log.txt` に `[INFO]` / `[WARN]` / `[ERROR]`、取得レコード数、対象レース一覧。

## 5. CLI仕様

```powershell
jvfetch.exe --week
jvfetch.exe --week --races "福島11,小倉11,福島10"
jvfetch.exe --odds-only
jvfetch.exe --check
```

- `--week`: 今週の開催全体(RA/SE/UM/HN/HC)を取得しCSV生成。
- `--week --races`: 対象レースを絞る。省略時は重賞+特別のみ。
- `--odds-only`: 単勝オッズのみ再取得(直前更新用・数十秒で完了すること)。
- `--check`: JVInit疎通・契約状態・データ提供状況の確認のみ。

exit code:

- `0`: 成功
- `1`: 部分成功(WARNあり・CSVは出力)
- `2`: 失敗(CSV出力なし)

ラッパー `jvfetch.bat`(`--week`) と `jvfetch-odds.bat`(`--odds-only`) をルートに置く(ダブルクリック運用)。

## 6. 実装手順(Step by Step)

1. プロジェクト雛形: `tools/jvfetch/` にC#コンソール(net48, x86)。COM参照追加。`--check`でJVInit→バージョン/契約状態を表示して終了する疎通確認まで。ここを最初の受け入れにする(COM/32bit問題を最初に潰す)。
2. RA/SE取得: JVOpen(今週範囲)→JVReadループ→レコード種別で振り分け→メモリ上のモデルへ。仕様書のバイト定義でパーサを書く(単体テスト: 仕様書の項目例と突き合わせ)。
3. `shutuba.csv`出力 + `week-config.draft.json`生成。
4. UM/HN取得→`pedigree.csv`(繁殖番号→名前の解決を含む)。
5. HC取得→`training.csv`(累計形式への整形)。
6. JVRTOpenでO1系→`odds.csv` + `--odds-only`モード。
7. バックアップ/ログ/exit code の整備、`jvfetch.bat`作成。
8. 突き合わせ検証: 同一レースについて (a)`jvfetch`出力 と (b)TARGET手動出力 の2系統でパイプラインを通し、`week-data.json`の差分を確認。馬名・オッズ・血統・調教の内容一致(指数のみTARGET側から供給)を確認して合格。

各Stepの共通Done:

- ビルド成功(x86)
- `--check`が通る環境で実行ログにERRORなし
- JRA-VAN由来の生成物がgit管理外

## 7. リスクと対策

| リスク | 対策 |
|---|---|
| 32bit COM問題(実行時にCOM生成失敗) | x86固定ビルドをStep1で検証。AnyCPU禁止をcsprojで固定 |
| 認証・契約状態(JVInitエラー) | `--check`で診断コードを表示。エラーコード表を仕様書から転記しREADMEへ |
| レコード仕様の思い込みパース | バイト定義は仕様書からの転記のみ許可。推測実装を禁止(§2) |
| データ提供タイミング(枠順確定・オッズ開始時刻より前に実行) | 取得0件時は「未提供の可能性」をWARNで案内。木曜夜/土曜朝の実行を推奨として運用手順に明記 |
| ウッド調教レコードの有無(仕様バージョン差) | 坂路(HC)のみで開始できる設計。取れれば追加(§3-4) |
| R0: JRA-VAN生データの再配布 | `data/target/`・`_backup/`・`bin/exe` をgitignore(既存方針の継続)。`jvfetch`出力もコミット禁止 |
| jvfetch障害時の週次運営 | TARGET手動出力の従来経路を残す(READMEに手動フォールバック手順を維持) |

## 8. 受け入れ条件(全体)

- `jvfetch.bat` 1回で、対象週の `shutuba` / `pedigree` / `training` / `odds` + `week-config.draft` が `data/target/` に揃う。
- そのまま `npm run import:target` がコード無変更で通り、`week-data.json`が生成される。
- `--odds-only` が60秒以内に完了し、オッズだけ更新→再生成の直前運用が成立する。
- `supplement.csv`が不要になっている(馬名・騎手が`shutuba.csv`に含まれる)。
- 突き合わせ検証(§6-8)で内容一致。
- JRA-VAN由来ファイルがgit管理外であることを`git status`で確認。

## 9. スケジュール目安(来週)

- Day1: Step1(疎通・x86問題の解消) ← ここが最大の不確実性。最優先で潰す。
- Day2-3: Step2-3(RA/SE→shutuba)。
- Day4: Step4-5(血統・調教)。
- Day5: Step6-7(オッズ・bat) → 週末: Step8(突き合わせ)して翌週から本番並走。

並走期間(最低1週)は`jvfetch`とTARGET手動の両方で生成して差分ゼロを確認してから切り替える。

---

以上。迷ったら「Node側を変えない方」「仕様書PDFを引く方」「手動で回る状態を壊さない方」を選ぶこと。
