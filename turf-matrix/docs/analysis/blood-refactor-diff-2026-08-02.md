# Blood AI カバレッジ・世代重み分離 差分レポート

- 対象日: 2026-08-02
- 対象: 2レース / 34頭
- 対象変更: 修正A（coverageとscoreの分離）、修正B（世代別重み）
- 本番TM INDEX / week-data.json: 未変更
- 4〜5代祖先: signalsには保持、score加算は0

## 全体判定

- coverageとscoreのPearson相関: 0.164（基準 |r| < 0.5: PASS）
- 未照合経路はscoreへ加減点せず、coverageとconfidenceにのみ反映します。
- 分布基準を満たさない項目は、着順や馬名に合わせて人工的に拡張せずFAILとして残します。

## 新潟7R アイビスサマーダッシュ

| 指標 | 修正前 | 修正後 | 受入基準 |
|---|---:|---:|---|
| 平均 | 77.50 | 65.00 | 参考 |
| 標準偏差 | 1.80 | 3.46 | 4.0〜7.0 FAIL |
| 最小 | 73 | 60 | 参考 |
| 最大 | 80 | 69 | 参考 |
| レンジ | 7 | 9 | 15以上 FAIL |
| 同一スコア3頭以上 | あり | あり | なし FAIL |

| 馬名 | 修正前 | 修正後 | 差分 | coverage | confidence | 発火ルール |
|---|---:|---:|---:|---:|---|---|
| アタリダイキチ | 79 | 64 | -15 | 0.547 | mid | Mr. Prospector系 / Seattle Slew・A.P. Indy系 / Sunday Silence系 / Deep Impact系 / Princely Gift・サクラバクシンオー系 |
| アメリカンステージ | 76 | 69 | -7 | 0.546 | mid | Mr. Prospector系 / 欧州スタミナ系 / Northern Dancer系 / Storm Cat・Harlan系 |
| ウイングレイテスト | 76 | 63 | -13 | 0.797 | high | Mr. Prospector系 / Roberto系 / Northern Dancer系 / Sunday Silence系 / Princely Gift・サクラバクシンオー系 / Danzig系 |
| エコロレジーナ | 76 | 64 | -12 | 0.398 | mid | Kingmambo系 / Mr. Prospector系 / 欧州スタミナ系 / Northern Dancer系 / Sunday Silence系 / Stay Gold系 / Danzig系 |
| カウスリップ | 76 | 61 | -15 | 0.559 | mid | Kingmambo系 / Mr. Prospector系 / 欧州スタミナ系 / Northern Dancer系 / Storm Cat・Harlan系 / Last Tycoon・Marju系 / Danzig系 |
| カウンターセブン | 78 | 67 | -11 | 0.399 | mid | Roberto系 / Northern Dancer系 / Sunday Silence系 / Deep Impact系 / Danzig系 |
| クムシラコ | 79 | 69 | -10 | 0.547 | mid | Mr. Prospector系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Danzig系 |
| シュラフ | 78 | 66 | -12 | 0.545 | mid | Mr. Prospector系 / Roberto系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / American Pharoah系 |
| テイエムスパーダ | 79 | 68 | -11 | 0.806 | high | Mr. Prospector系 / Northern Dancer系 / Storm Cat・Harlan系 / Taiki Shuttle系 / Grey Sovereign系 |
| デュガ | 78 | 69 | -9 | 0.541 | mid | Mr. Prospector系 / Seattle Slew・A.P. Indy系 / Northern Dancer系 / Storm Cat・Harlan系 / Danzig系 |
| バグラダス | 80 | 60 | -20 | 0.799 | high | Mr. Prospector系 / Seattle Slew・A.P. Indy系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Deep Impact系 |
| ビッグシーザー | 78 | 69 | -9 | 0.552 | mid | Kingmambo系 / Mr. Prospector系 / 欧州スタミナ系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Princely Gift・サクラバクシンオー系 |
| ピューロマジック | 80 | 68 | -12 | 0.794 | high | Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Deep Impact系 / Hennessy・ヘニーヒューズ系 / Grey Sovereign系 |
| ブーケファロス | 75 | 69 | -6 | 0.561 | mid | Kingmambo系 / Mr. Prospector系 / Roberto系 / 欧州スタミナ系 / Northern Dancer系 / Princely Gift・サクラバクシンオー系 |
| フロムダスク | 73 | 61 | -12 | 0.560 | mid | Mr. Prospector系 / Seattle Slew・A.P. Indy系 / Roberto系 / 欧州スタミナ系 / Northern Dancer系 / Storm Cat・Harlan系 |
| ベルギューン | 78 | 61 | -17 | 0.545 | mid | Kingmambo系 / Mr. Prospector系 / Seattle Slew・A.P. Indy系 / Roberto系 / 欧州スタミナ系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Taiki Shuttle系 / Blame・Arch系 / Danzig系 |
| ミカッテヨンデイイ | 77 | 62 | -15 | 0.285 | low | Mr. Prospector系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Stay Gold系 / Grey Sovereign系 |
| ロードトレイル | 79 | 60 | -19 | 0.807 | high | Kingmambo系 / Mr. Prospector系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Deep Impact系 / Last Tycoon・Marju系 |
## 札幌11R 北海道新聞杯クイーンステークス

| 指標 | 修正前 | 修正後 | 受入基準 |
|---|---:|---:|---|
| 平均 | 80.06 | 67.13 | 参考 |
| 標準偏差 | 1.75 | 2.15 | 4.0〜7.0 FAIL |
| 最小 | 76 | 64 | 参考 |
| 最大 | 82 | 70 | 参考 |
| レンジ | 6 | 6 | 15以上 FAIL |
| 同一スコア3頭以上 | あり | あり | なし FAIL |

| 馬名 | 修正前 | 修正後 | 差分 | coverage | confidence | 発火ルール |
|---|---:|---:|---:|---:|---|---|
| アンゴラブラック | 81 | 70 | -11 | 0.809 | high | Kingmambo系 / Mr. Prospector系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Deep Impact系 / Last Tycoon・Marju系 / Grey Sovereign系 |
| ヴーレヴー | 80 | 69 | -11 | 0.546 | mid | Mr. Prospector系 / Roberto系 / Northern Dancer系 / Sunday Silence系 / Last Tycoon・Marju系 |
| エラトー | 80 | 65 | -15 | 0.155 | low | Kingmambo系 / Mr. Prospector系 / 欧州スタミナ系 / Northern Dancer系 / Sunday Silence系 / Deep Impact系 / Last Tycoon・Marju系 / Danzig系 / Grey Sovereign系 |
| エリカエクスプレス | 82 | 69 | -13 | 0.803 | high | Mr. Prospector系 / Seattle Slew・A.P. Indy系 / Roberto系 / 欧州スタミナ系 / Northern Dancer系 / Sunday Silence系 / Danzig系 |
| カテリーナ | 80 | 64 | -16 | 0.548 | mid | Mr. Prospector系 / Roberto系 / 欧州スタミナ系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 |
| クリノメイ | 80 | 68 | -12 | 0.557 | mid | Mr. Prospector系 / Northern Dancer系 / Sunday Silence系 / Stay Gold系 / Danzig系 |
| ケリフレッドアスク | 82 | 69 | -13 | 0.820 | high | Kingmambo系 / Mr. Prospector系 / Roberto系 / 欧州スタミナ系 / Northern Dancer系 / Sunday Silence系 / Deep Impact系 / Last Tycoon・Marju系 / Danzig系 / Grey Sovereign系 |
| コガネノソラ | 80 | 68 | -12 | 0.534 | mid | Mr. Prospector系 / Northern Dancer系 / Sunday Silence系 / Stay Gold系 / Taiki Shuttle系 / Danzig系 |
| ココナッツブラウン | 80 | 64 | -16 | 0.818 | high | Kingmambo系 / Mr. Prospector系 / Northern Dancer系 / Sunday Silence系 / Princely Gift・サクラバクシンオー系 / Last Tycoon・Marju系 / Grey Sovereign系 |
| パレハ | 81 | 69 | -12 | 0.807 | high | Mr. Prospector系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Deep Impact系 / Last Tycoon・Marju系 |
| ピンクジン | 76 | 65 | -11 | 0.135 | low | Mr. Prospector系 / Northern Dancer系 / Sunday Silence系 / Deep Impact系 |
| フェスティバルヒル | 81 | 67 | -14 | 0.411 | mid | Kingmambo系 / Mr. Prospector系 / 欧州スタミナ系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Heart's Cry系 / Last Tycoon・Marju系 / Grey Sovereign系 |
| フレミングフープ | 81 | 65 | -16 | 0.547 | mid | Mr. Prospector系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Heart's Cry系 / Grey Sovereign系 |
| ボンドガール | 76 | 64 | -12 | 0.128 | low | Mr. Prospector系 / Seattle Slew・A.P. Indy系 / Northern Dancer系 / Sunday Silence系 / Danzig系 |
| リラボニート | 79 | 69 | -10 | 0.538 | mid | Mr. Prospector系 / Roberto系 / Northern Dancer系 / Sunday Silence系 / Danzig系 |
| ルージュソリテール | 82 | 69 | -13 | 0.810 | high | Kingmambo系 / Mr. Prospector系 / Northern Dancer系 / Storm Cat・Harlan系 / Sunday Silence系 / Deep Impact系 / Princely Gift・サクラバクシンオー系 / Last Tycoon・Marju系 |

## 結論

coverageとscoreの分離、および4〜5代祖先の非加点化は完了しました。
一方、原因A/Bだけでは指定された分散・レンジ・同点基準を満たしていません。
この候補値は本番へ反映せず、重複系統の集約とコース適合規則を次の独立した検証対象とします。
