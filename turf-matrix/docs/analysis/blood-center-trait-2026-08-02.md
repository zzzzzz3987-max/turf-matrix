# Blood AI レース非依存trait center what-if (2026-08-02)

> review-only。本番Blood AI、TM INDEX、week-data.jsonには接続していません。着順・人気・オッズ・出走馬からcenterを決めていません。

## center定義

現辞書には単一のtraitScoreがないため、各leafルールの `speed / power / stamina / sustain` の算術平均×100をレース非依存traitScoreと定義しました。系統ツリーdepthと血統表上の世代は混同していません。Bloodlineルールは父・母父・父父・母母・3代の適用可能重み合計0.95、Female lineルールは母父・母母・3代の合計0.43をweighted medianの母集団重みに使用しました。

- center_trait: **73.000**
- leafルール: 24 / 全27件
- 母集団総重み: 19.680
- 全レース共通center: PASS
- 予測値約95とは大きく異なります。trait平均と旧compatibilityForは同一尺度ではないため、数値を調整していません。

## leaf母集団

| rule | source | depth | traitScore | weight |
|---|---|---:|---:|---:|
| kingmambo | bloodline | 2 | 78.750 | 0.950 |
| mr_prospector | bloodline | 1 | 66.750 | 0.950 |
| seattle_slew_ap_indy | bloodline | 2 | 73.500 | 0.950 |
| european_stamina | bloodline | 1 | 76.250 | 0.950 |
| harlan_speed | bloodline | 3 | 69.750 | 0.950 |
| sunday_silence | bloodline | 1 | 66.250 | 0.950 |
| deep_impact | bloodline | 2 | 70.500 | 0.950 |
| stay_gold | bloodline | 2 | 79.000 | 0.950 |
| heart_cry | bloodline | 2 | 78.500 | 0.950 |
| harbinger | bloodline | 2 | 77.500 | 0.950 |
| hennessy_sprint | bloodline | 3 | 70.000 | 0.950 |
| taiki_shuttle_sprint | bloodline | 2 | 69.500 | 0.950 |
| princely_gift_sprint | bloodline | 3 | 66.000 | 0.950 |
| blame_arch_power | bloodline | 3 | 77.000 | 0.950 |
| american_pharoah_speed | bloodline | 3 | 74.000 | 0.950 |
| last_tycoon_marju | bloodline | 2 | 78.000 | 0.950 |
| danzig | bloodline | 2 | 68.000 | 0.950 |
| grey_sovereign | bloodline | 1 | 73.000 | 0.950 |
| almahmoud | femaleLine | 1 | 65.500 | 0.430 |
| la_troienne | femaleLine | 1 | 78.500 | 0.430 |
| somethingroyal | femaleLine | 1 | 71.500 | 0.430 |
| best_in_show | femaleLine | 1 | 69.750 | 0.430 |
| special | femaleLine | 1 | 78.500 | 0.430 |
| rough_shod | femaleLine | 1 | 78.500 | 0.430 |

## B / E / G 比較

`B adjusted = 7.5 × tanh(horse_raw / 18.75)` と明示し、従来の `×0.4` と数学的に等価なscaleとして扱っています。

| セル | center / scale | coverage-score相関 | 飽和ペア | 最大|raw/scale| | raw平均 | raw SD |
|---|---|---:|---:|---:|---:|---:|
| B | center82 / 18.75 | 0.354 | 0 | 1.440 | 13.171 | 10.960 |
| E | center82 / 7.5 | 0.297 | 41 | 3.600 | 13.171 | 10.960 |
| G | leaf trait center 73.000 / 18.75 | 0.270 | 0 | 0.373 | -0.556 | 4.282 |

## G採用判定: **PASS**

- coverage-score相関 < 0.3（飽和0と同時成立）: PASS (0.270, 飽和0組)
- 飽和ペア0組: PASS
- 最大|raw/scale| < 1.5: PASS (0.373)
- centerが全レース同一: PASS (73.000)
- 同一ルール集合なら同一スコア: PASS
- 辞書追加感度、経路重複排除、汎用タグ、未照合馬は既存Blood AI回帰テストで継続確認します。

## 34頭スコア

| レース | 馬名 | coverage | 採用ルール | B | E | G | G-B差 | G raw |
|---|---|---:|---|---:|---:|---:|---:|---:|
| 新潟7R アイビスサマーダッシュ | ビッグシーザー | 0.552 | princely_gift_sprint | 71.640 | 72.486 | 62.323 | -9.317 | -7.000 |
| 新潟7R アイビスサマーダッシュ | ウイングレイテスト | 0.797 | princely_gift_sprint, sunday_silence | 71.561 | 72.483 | 62.327 | -9.234 | -6.990 |
| 新潟7R アイビスサマーダッシュ | デュガ | 0.541 | harlan_speed | 70.222 | 72.299 | 63.713 | -6.509 | -3.250 |
| 新潟7R アイビスサマーダッシュ | テイエムスパーダ | 0.806 | grey_sovereign, taiki_shuttle_sprint | 71.505 | 72.480 | 63.649 | -7.855 | -3.415 |
| 新潟7R アイビスサマーダッシュ | クムシラコ | 0.547 | storm_cat, sunday_silence | 70.157 | 72.282 | 63.492 | -6.666 | -3.823 |
| 新潟7R アイビスサマーダッシュ | ブーケファロス | 0.561 | princely_gift_sprint, roberto | 71.496 | 72.479 | 62.432 | -9.064 | -6.689 |
| 新潟7R アイビスサマーダッシュ | アメリカンステージ | 0.546 | european_stamina, harlan_speed | 69.920 | 72.211 | 63.774 | -6.146 | -3.091 |
| 新潟7R アイビスサマーダッシュ | カウンターセブン | 0.399 | danzig, deep_impact | 69.779 | 72.161 | 63.352 | -6.428 | -4.189 |
| 新潟7R アイビスサマーダッシュ | エコロレジーナ | 0.398 | danzig, stay_gold | 69.889 | 72.200 | 63.365 | -6.524 | -4.154 |
| 新潟7R アイビスサマーダッシュ | ピューロマジック | 0.794 | deep_impact, hennessy_sprint | 70.107 | 72.268 | 63.885 | -6.221 | -2.808 |
| 新潟7R アイビスサマーダッシュ | シュラフ | 0.545 | american_pharoah_speed, sunday_silence | 68.063 | 70.960 | 65.324 | -2.739 | 0.811 |
| 新潟7R アイビスサマーダッシュ | ロードトレイル | 0.807 | deep_impact, storm_cat | 66.934 | 69.336 | 63.987 | -2.947 | -2.548 |
| 新潟7R アイビスサマーダッシュ | アタリダイキチ | 0.547 | deep_impact, princely_gift_sprint | 66.965 | 69.391 | 63.963 | -3.002 | -2.610 |
| 新潟7R アイビスサマーダッシュ | バグラダス | 0.799 | deep_impact, seattle_slew_ap_indy | 66.547 | 68.601 | 64.051 | -2.495 | -2.385 |
| 新潟7R アイビスサマーダッシュ | ミカッテヨンデイイ | 0.285 | sunday_silence, sunday_silence | 66.336 | 68.164 | 62.411 | -3.925 | -6.750 |
| 新潟7R アイビスサマーダッシュ | フロムダスク | 0.560 | seattle_slew_ap_indy, storm_cat | 66.117 | 67.688 | 64.352 | -1.765 | -1.625 |
| 新潟7R アイビスサマーダッシュ | カウスリップ | 0.559 | european_stamina, storm_cat | 60.662 | 58.034 | 64.900 | +4.238 | -0.250 |
| 新潟7R アイビスサマーダッシュ | ベルギューン | 0.545 | blame_arch_power, taiki_shuttle_sprint | 60.609 | 58.007 | 66.354 | +5.745 | 3.423 |
| 札幌11R 北海道新聞杯クイーンステークス | リラボニート | 0.538 | roberto | 71.703 | 72.489 | 67.231 | -4.472 | 5.750 |
| 札幌11R 北海道新聞杯クイーンステークス | フェスティバルヒル | 0.411 | heart_cry, kingmambo | 71.511 | 72.480 | 67.169 | -4.342 | 5.581 |
| 札幌11R 北海道新聞杯クイーンステークス | エリカエクスプレス | 0.803 | european_stamina, roberto | 71.646 | 72.487 | 67.208 | -4.437 | 5.689 |
| 札幌11R 北海道新聞杯クイーンステークス | ヴーレヴー | 0.546 | last_tycoon_marju, sunday_silence | 71.638 | 72.486 | 66.847 | -4.791 | 4.713 |
| 札幌11R 北海道新聞杯クイーンステークス | フレミングフープ | 0.547 | heart_cry, storm_cat | 71.331 | 72.469 | 67.056 | -4.276 | 5.274 |
| 札幌11R 北海道新聞杯クイーンステークス | ココナッツブラウン | 0.818 | kingmambo, sunday_silence | 71.565 | 72.483 | 67.054 | -4.511 | 5.269 |
| 札幌11R 北海道新聞杯クイーンステークス | コガネノソラ | 0.534 | stay_gold | 69.436 | 72.016 | 67.321 | -2.115 | 6.000 |
| 札幌11R 北海道新聞杯クイーンステークス | クリノメイ | 0.557 | danzig, stay_gold | 69.340 | 71.968 | 67.224 | -2.116 | 5.732 |
| 札幌11R 北海道新聞杯クイーンステークス | パレハ | 0.807 | deep_impact, last_tycoon_marju | 70.741 | 72.404 | 65.843 | -4.898 | 2.115 |
| 札幌11R 北海道新聞杯クイーンステークス | ケリフレッドアスク | 0.820 | deep_impact, kingmambo | 70.702 | 72.398 | 66.024 | -4.678 | 2.577 |
| 札幌11R 北海道新聞杯クイーンステークス | ルージュソリテール | 0.810 | deep_impact, kingmambo | 70.702 | 72.398 | 66.024 | -4.678 | 2.577 |
| 札幌11R 北海道新聞杯クイーンステークス | アンゴラブラック | 0.809 | deep_impact, kingmambo | 69.733 | 72.143 | 65.269 | -4.463 | 0.673 |
| 札幌11R 北海道新聞杯クイーンステークス | エラトー | 0.155 | deep_impact | 67.321 | 69.980 | 64.006 | -3.315 | -2.500 |
| 札幌11R 北海道新聞杯クイーンステークス | ピンクジン | 0.135 | deep_impact | 67.321 | 69.980 | 64.006 | -3.315 | -2.500 |
| 札幌11R 北海道新聞杯クイーンステークス | カテリーナ | 0.548 | european_stamina, sunday_silence | 63.810 | 62.150 | 64.302 | +0.492 | -1.750 |
| 札幌11R 北海道新聞杯クイーンステークス | ボンドガール | 0.128 | sunday_silence | 63.093 | 60.712 | 62.411 | -0.682 | -6.750 |

## 結論

Gは指定した受入基準を満たしました。ただしtraitScoreの暫定定義を含むため、本番接続前にtrait/courseFitの完全分離設計を確認する必要があります。

