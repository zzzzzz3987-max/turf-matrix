# TURF MATRIX PAD レース一括保存 手順書

この手順書は、木曜・金曜に TARGET frontier JV から必要データを保存し、TURF MATRIX の週次更新へつなぐための運用メモです。

今週は新機能を増やさず、以下を最優先にします。

```text
重賞2レース: 七夕賞を超える分析品質
特別レース: 軽量分析で安定掲載
```

## 目的

人間が毎週やる作業を、できるだけ以下に近づけます。

```text
1. TARGETを更新する
2. PADを実行してCSV/HTMLを固定フォルダへ保存する
3. 確認コマンドを実行する
4. 土曜にオッズを入れて公開する
```

PADに競馬データの意味を理解させる必要はありません。
PADには、TARGET画面を開いて、決められたファイル名で保存する作業だけを任せます。

## 役割分担

TURF MATRIX側で自動化すること:

- レース入力フォルダを作る
- PAD用の保存先一覧を作る
- 入力ファイルを検証する
- プレビュー用データを生成する
- TM INDEX / TM VALUE / AI総評を生成する
- buildする
- 土曜に本番公開する

PAD側で自動化すること:

- TARGETを起動する
- TARGETを更新する
- 対象レースを開く
- CSV/HTMLを保存する
- 保存後に確認コマンドを実行する

人間が確認すること:

- 今週の対象レースが正しいか
- TARGET更新が完了しているか
- 重賞の血統・調教データが取れているか
- プレビューが崩れていないか
- 公開前に `inspect:race-batch` が通っているか

## 事前準備

PowerShellで以下を実行します。

```powershell
Set-Location "C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix"
npm run scaffold:race-batch
npm run pad:manifest
```

生成されるファイル:

```text
tools/pad-runtime/race-batch-manifest.json
tools/pad-runtime/race-batch-manifest.md
```

この2つはPAD用の保存先一覧です。
git管理外なので、毎週作り直してOKです。

## 木曜にやること

木曜はオッズなしで、出走馬・近走・血統・調教を先に取り込みます。
本番公開はしません。

### 木曜の取得優先度

| レース種別 | 必須 | できれば取得 |
| --- | --- | --- |
| 重賞 | `current-race-detail.csv`, `all.csv`, `training-slope.html`, `training-wood.html`, `pedigree/*.html` | 追加の血統HTML |
| 特別レース | `current-race-detail.csv`, `all.csv` | `training-slope.html`, `training-wood.html`, `pedigree/*.html` |

重賞はTURF MATRIXの顔なので、血統と調教をできるだけ厚く取ります。
特別レースは軽量分析でよいので、最低限 `current-race-detail.csv` と `all.csv` があれば進めます。

### 木曜PADフロー

Power Automate Desktopで、以下の流れを記録します。

```text
フロー名:
TURF MATRIX 木曜データ保存

1. TARGET frontier JVを起動
2. TARGETのメイン画面が表示されるまで待つ
3. TARGETデータ更新を実行、または更新済みであることを確認
4. tools/pad-runtime/race-batch-manifest.md を開く
5. マニフェストの対象レースごとに以下を繰り返す
   5-1. TARGETで対象レースを開く
   5-2. 出馬表詳細CSVを出力
   5-3. current-race-detail.csv として保存
   5-4. TARGETの「全て」CSVを出力
   5-5. all.csv として保存
   5-6. 重賞なら坂路調教HTMLを保存
   5-7. training-slope.html として保存
   5-8. 重賞ならウッド/CW/D調教HTMLを保存
   5-9. training-wood.html として保存
   5-10. 重賞なら馬ごとの4代血統HTMLを pedigree フォルダへ保存
6. PowerShellで npm run inspect:race-batch を実行
7. PowerShellで npm run thursday:preview を実行
```

PADで使う固定変数:

```text
RepoRoot = C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix
ManifestMd = %RepoRoot%\tools\pad-runtime\race-batch-manifest.md
ManifestJson = %RepoRoot%\tools\pad-runtime\race-batch-manifest.json
```

### PADで使う主なアクション

| PADアクション | 用途 |
| --- | --- |
| アプリケーションの実行 | TARGETを起動 |
| ウィンドウを待機 | TARGET画面の表示待ち |
| キーの送信 | TARGETのメニュー操作 |
| UI要素のクリック | TARGET画面操作 |
| テキストフィールドに入力 | 保存ファイル名を指定 |
| ファイルが存在する場合 | 保存成功チェック |
| PowerShellスクリプトの実行 | 確認コマンド実行 |

### 保存ルール

```text
必ずマニフェストに書かれたパスへ上書き保存する
日付・開催場・レース名をファイル名に足さない
日本語レース名をファイル名に使わない
```

正しいファイル名:

```text
current-race-detail.csv
all.csv
training-slope.html
training-wood.html
odds.csv
```

## 木曜の確認コマンド

PAD保存後に実行します。

```powershell
npm run inspect:race-batch
npm run thursday:preview
```

木曜の成功条件:

- 設定済みのレースフォルダが存在する
- 重賞に `current-race-detail.csv` と `all.csv` がある
- 重賞に調教HTMLと血統HTMLができるだけ揃っている
- 特別レースに `current-race-detail.csv` と `all.csv` がある
- `tools/week-data.json` は更新されない
- commit / push は行われない

重賞の調教・血統が足りない場合:

1. そのまま無視しない
2. 該当重賞だけTARGETから再保存する
3. `npm run inspect:race-batch` を再実行する
4. TARGET側に本当にデータがない場合だけ、`未取得` または `一部取得` として扱う

## 金曜・土曜にやること

金曜または土曜はオッズを追加します。
ここで初めて本番公開へ進めます。

### 金曜・土曜PADフロー

```text
フロー名:
TURF MATRIX オッズ保存

1. TARGET frontier JVを起動
2. TARGETデータ更新を実行
3. tools/pad-runtime/race-batch-manifest.md を開く
4. 対象レースごとにオッズ画面を開く
5. オッズCSVを出力
6. 各レースフォルダへ odds.csv として保存
7. PowerShellで npm run inspect:race-batch を実行
8. 問題なければ npm run saturday:publish を実行
```

金曜・土曜の必須ファイル:

| レース種別 | 必須 |
| --- | --- |
| 重賞 | `odds.csv` |
| 特別レース | `odds.csv` |

## 金曜・土曜の確認コマンド

```powershell
npm run inspect:race-batch
npm run saturday:publish
```

土曜の成功条件:

- 全レースに `odds.csv` がある
- オッズ件数と出走頭数が一致する
- TM VALUEが実オッズから計算される
- buildが成功する
- `week-data.json` が安全に更新される
- commit / push が安全な公開フローで実行される

## 失敗時の止め方

PAD内で最低限チェックすること:

- 保存したファイルが存在する
- ファイルサイズが1KB以上
- CSVが空ではない
- 重賞の必須ファイルがない場合は停止
- 特別レースの任意HTMLがない場合はログだけ残して続行

停止メッセージ例:

```text
TURF MATRIXの保存処理を停止しました。
重賞の必須ファイルが不足しています。

不足ファイル:
%MissingPath%

TARGETから再保存して、npm run inspect:race-batch を再実行してください。
```

## 公開してはいけない状態

以下の場合は公開しません。

- 重賞のレース名・開催場・R番号が違う
- 重賞の出走頭数が違う
- オッズが0埋めされている
- 人気を推測している
- TM INDEXやAI総評が別レースから流用されている
- `git status --short` に生CSV/HTMLが出ている
- `inspect:race-batch` が失敗している
- buildが失敗している

## 今週の品質基準

重賞:

- 七夕賞より分析文が読みやすい
- 血統は4ライン表示だけでなく、強みまで説明する
- 調教は最終追切・終い・加速ラップを説明する
- AI総評が日本語で自然に読める
- TM INDEX / TM VALUE が実データから出る

特別レース:

- 軽量分析でよい
- TM INDEXを出す
- オッズ後にTM VALUEを出す
- 短めのAI総評を出す
- 調教・血統がない場合は正直に `未取得` と表示する

## 今後の方向性

短期:

```text
PAD + マニフェスト方式で木曜保存を安定化
```

中期:

```text
JV-Link直取得で出馬表・出走馬・オッズを置き換える
```

長期:

```text
PAD依存を重賞の補助HTMLだけに減らす
```

今週は拡張しません。
まずは、重賞2レースを毎週きちんと更新できる運用を成功させます。
