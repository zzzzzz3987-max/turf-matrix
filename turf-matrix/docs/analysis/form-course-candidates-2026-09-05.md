# Form加重平均・Course芝ダート分離の比較 2026-09-05

本番未接続。Formだけ、Courseだけ、両方の3候補を同じ保存入力で比較。係数は結果を見て調整していない。今回発見に使った日をholdoutと呼ばない。新規レースの事前固定検証は0件。
現行計算が保存値へ一致しないレース、結果JOIN不成立のレースは全方式で除外。その他の因子と補正は保存値に固定し、経験数補正だけは候補の基本指数に対して再計算する。

## historical-exploratory

| 方式 | レース | 1着 | 3着内 | 複勝的中 | 単勝回収率 | 複勝回収率 | 首位変更 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 10 | 3 | 3 | 3 | 67% | 35% | 0 |
| form | 10 | 2 | 3 | 3 | 32% | 37% | 1 |
| course | 10 | 3 | 3 | 3 | 67% | 35% | 1 |
| combined | 10 | 2 | 3 | 3 | 32% | 37% | 1 |

## discovery-day-not-holdout

| 方式 | レース | 1着 | 3着内 | 複勝的中 | 単勝回収率 | 複勝回収率 | 首位変更 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 9 | 0 | 5 | 4 | 0% | 77.8% | 0 |
| form | 9 | 0 | 5 | 4 | 0% | 77.8% | 0 |
| course | 9 | 0 | 5 | 4 | 0% | 77.8% | 0 |
| combined | 9 | 0 | 5 | 4 | 0% | 77.8% | 0 |

## all

| 方式 | レース | 1着 | 3着内 | 複勝的中 | 単勝回収率 | 複勝回収率 | 首位変更 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 19 | 3 | 8 | 7 | 35.3% | 55.3% | 0 |
| form | 19 | 2 | 8 | 7 | 16.8% | 56.3% | 1 |
| course | 19 | 3 | 8 | 7 | 35.3% | 55.3% | 1 |
| combined | 19 | 2 | 8 | 7 | 16.8% | 56.3% | 1 |

## 首位変更の全件

| 日付・レース | 現行 | Form | Course | 両方 |
|---|---|---|---|---|
| 2026-08-30 札幌10R | ララバニュルス 81点 (4着) | ララバニュルス 84点 (4着) | ルージュベルベット 81点 (6着) | ララバニュルス 84点 (4着) |
| 2026-08-30 新潟8R | ゾロアストロ 83点 (1着) | ロデオドライブ 85点 (2着) | ゾロアストロ 83点 (1着) | ロデオドライブ 85点 (2着) |

## 除外

- 2026-07-25 2026-07-25-sapporo-10R: missing frozen correction: アスクデッドヒート
- 2026-07-25 2026-07-25-chukyo-06R: missing frozen correction: ゼロヴィジビリティ
- 2026-07-25 2026-07-25-niigata-06R: missing frozen correction: コルドンブルー
- 2026-07-25 2026-07-25-sapporo-11R: missing frozen correction: ロジケープ
- 2026-07-25 2026-07-25-chukyo-07R: missing frozen correction: ミュージシャン
- 2026-07-25 2026-07-25-niigata-07R: missing frozen correction: コートアリシアン
- 2026-07-25 2026-07-25-sapporo-12R: missing frozen correction: ハイクオリティ
- 2026-07-25 2026-07-25-chukyo-08R: missing frozen correction: ブラックシャリマー
- 2026-07-25 2026-07-25-niigata-08R: missing frozen correction: ケルピー
- 2026-07-26 2026-07-26-sapporo-10R: missing frozen correction: ワタシマツワ
- 2026-07-26 2026-07-26-chukyo-06R: missing frozen correction: サヴォアフェール
- 2026-07-26 2026-07-26-niigata-06R: missing frozen correction: モリノセピア
- 2026-07-26 2026-07-26-sapporo-11R: missing frozen correction: レクスノヴァス
- 2026-07-26 2026-07-26-chukyo-07R: missing frozen correction: ベルジュロネット
- 2026-07-26 2026-07-26-niigata-07R: missing frozen correction: ダノンセンチュリー
- 2026-07-26 2026-07-26-sapporo-12R: missing frozen correction: デルシエロ
- 2026-07-26 2026-07-26-chukyo-08R: missing frozen correction: ハギノコラソン
- 2026-07-26 2026-07-26-niigata-08R: missing frozen correction: コンアフェット
- 2026-08-02 2026-08-02-sapporo-10R: missing frozen correction: チャーリー
- 2026-08-02 2026-08-02-chukyo-06R: missing frozen correction: アイニードユー
- 2026-08-02 2026-08-02-niigata-06R: missing frozen correction: ブレトワルダ
- 2026-08-02 2026-08-02-sapporo-11R: missing frozen correction: ココナッツブラウン
- 2026-08-02 2026-08-02-chukyo-07R: missing frozen correction: タイトニット
- 2026-08-02 2026-08-02-niigata-07R: missing frozen correction: アメリカンステージ
- 2026-08-02 2026-08-02-sapporo-12R: missing frozen correction: デンプシー
- 2026-08-02 2026-08-02-chukyo-08R: missing frozen correction: セルヴァンス
- 2026-08-02 2026-08-02-niigata-08R: missing frozen correction: キアラメンテ
- 2026-08-08 2026-08-08-sapporo-10R: missing frozen correction: スカイサーベイ
- 2026-08-08 2026-08-08-niigata-06R: missing frozen correction: クライスレリアーナ
- 2026-08-08 2026-08-08-chukyo-06R: missing frozen correction: テイエムアイラン
- 2026-08-08 2026-08-08-sapporo-11R: missing frozen correction: ウェイワードアクト
- 2026-08-08 2026-08-08-niigata-07R: missing frozen correction: エストゥペンダ
- 2026-08-08 2026-08-08-chukyo-07R: missing frozen correction: タガノマカシヤ
- 2026-08-08 2026-08-08-sapporo-12R: missing frozen correction: ルクスジニア
- 2026-08-08 2026-08-08-niigata-08R: missing frozen correction: カレンハウ
- 2026-08-08 2026-08-08-chukyo-08R: missing frozen correction: リアンドゥクール
- 2026-08-09 2026-08-09-sapporo-10R: missing frozen correction: タガノエルー
- 2026-08-09 2026-08-09-niigata-06R: missing frozen correction: ライヒスアドラー
- 2026-08-09 2026-08-09-chukyo-06R: missing frozen correction: マイバレンタイン
- 2026-08-09 2026-08-09-sapporo-11R: missing frozen correction: カンティーユ
- 2026-08-09 2026-08-09-niigata-07R: missing frozen correction: パイロマンサー
- 2026-08-09 2026-08-09-chukyo-07R: missing frozen correction: レイピア
- 2026-08-09 2026-08-09-sapporo-12R: missing frozen correction: マイネルシンベリン
- 2026-08-09 2026-08-09-niigata-08R: missing frozen correction: カレンデュラ
- 2026-08-09 2026-08-09-chukyo-08R: missing frozen correction: クロノスバレット
- 2026-08-15 2026-08-15-sapporo-09R: missing frozen correction: コスモハナミズキ
- 2026-08-15 2026-08-15-niigata-06R: missing frozen correction: ブラックオリンピア
- 2026-08-15 2026-08-15-sapporo-10R: missing frozen correction: セイプリーズ
- 2026-08-15 2026-08-15-chukyo-06R: missing frozen correction: モンテディアーナ
- 2026-08-15 2026-08-15-niigata-07R: missing frozen correction: ライトニングゼウス
- 2026-08-15 2026-08-15-sapporo-11R: missing frozen correction: セボンサデッセ
- 2026-08-15 2026-08-15-chukyo-07R: missing frozen correction: ダノンジャイアン
- 2026-08-15 2026-08-15-niigata-08R: missing frozen correction: ベストブラザーズ
- 2026-08-15 2026-08-15-sapporo-12R: missing frozen correction: ミッキーファルコン
- 2026-08-15 2026-08-15-chukyo-08R: missing frozen correction: チェルヴァーラ
- 2026-08-15 2026-08-15-niigata-09R: missing frozen correction: シャンデルナゴル
- 2026-08-16 2026-08-16-sapporo-09R: missing frozen correction: ハッピーラッキー
- 2026-08-16 2026-08-16-niigata-06R: missing frozen correction: カウスリップ
- 2026-08-16 2026-08-16-chukyo-06R: missing frozen correction: パフュームセント
- 2026-08-16 2026-08-16-sapporo-10R: missing frozen correction: ウーマンズパワー
- 2026-08-16 2026-08-16-niigata-07R: missing frozen correction: ヤマニンアルリフラ
- 2026-08-16 2026-08-16-chukyo-07R: missing frozen correction: サトノシャイニング
- 2026-08-16 2026-08-16-sapporo-11R: missing frozen correction: サクラファレル
- 2026-08-16 2026-08-16-niigata-08R: missing frozen correction: ラストレガシー
- 2026-08-16 2026-08-16-chukyo-08R: missing frozen correction: ラインジーク
- 2026-08-16 2026-08-16-sapporo-12R: missing frozen correction: ダノンヒストリー
- 2026-08-22 2026-08-22-sapporo-09R: missing frozen correction: チカバリエンテ
- 2026-08-22 2026-08-22-niigata-06R: missing frozen correction: コートアリシアン
- 2026-08-22 2026-08-22-chukyo-06R: missing frozen correction: ライノ
- 2026-08-22 2026-08-22-sapporo-10R: missing frozen correction: ビービーエフォート
- 2026-08-22 2026-08-22-niigata-07R: missing frozen correction: ヤブサメ
- 2026-08-22 2026-08-22-chukyo-07R: missing frozen correction: ヨリノレジェンド
- 2026-08-22 2026-08-22-sapporo-11R: missing frozen correction: フクノブルーレイク
- 2026-08-22 2026-08-22-niigata-08R: missing frozen correction: プルメリアリノ
- 2026-08-22 2026-08-22-chukyo-08R: missing frozen correction: バケラッタ
- 2026-08-22 2026-08-22-sapporo-12R: missing frozen correction: メイショウコシュウ
- 2026-08-23 2026-08-23-sapporo-09R: missing frozen correction: エチゴドラゴン
- 2026-08-23 2026-08-23-niigata-06R: missing frozen correction: ブレトワルダ
- 2026-08-23 2026-08-23-chukyo-06R: missing frozen correction: コルドンブルー
- 2026-08-23 2026-08-23-sapporo-10R: missing frozen correction: ローズマイスター
- 2026-08-23 2026-08-23-niigata-07R: missing frozen correction: シャンデヴァーグ
- 2026-08-23 2026-08-23-chukyo-07R: missing frozen correction: ハギノサステナブル
- 2026-08-23 2026-08-23-sapporo-11R: missing frozen correction: パンジャタワー
- 2026-08-23 2026-08-23-niigata-08R: missing frozen correction: ラパンチュール
- 2026-08-23 2026-08-23-chukyo-08R: missing frozen correction: カーリキュー
- 2026-08-23 2026-08-23-sapporo-12R: missing frozen correction: ルクスジニア
- 2026-08-29 2026-08-29-niigata-06R: missing frozen correction: ルシャルムール
- 2026-08-29 2026-08-29-sapporo-10R: missing frozen correction: タイフーンナイン
- 2026-08-29 2026-08-29-chukyo-06R: missing frozen correction: バッハアルプゼー
- 2026-08-29 2026-08-29-niigata-07R: missing frozen correction: ボウウィンドウ
- 2026-08-29 2026-08-29-sapporo-11R: missing frozen correction: アリスメティーク
- 2026-08-29 2026-08-29-chukyo-07R: missing frozen correction: ボンヌソワレ
- 2026-08-29 2026-08-29-niigata-08R: missing frozen correction: タガノバビロン
- 2026-08-29 2026-08-29-sapporo-12R: missing frozen correction: オンザムービー
- 2026-08-29 2026-08-29-chukyo-08R: missing frozen correction: ワンコールアウェイ
