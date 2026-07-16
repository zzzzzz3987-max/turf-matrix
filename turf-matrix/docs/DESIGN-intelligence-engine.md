# TURF MATRIX Intelligence Engine 設計書 v1.0

対象読者: Codex(実装AI) / 作成: Chief AI Architect
前提: **週次自動更新パイプライン設計書 v1.0(以下「基盤設計書」)を変更せず、その上に載せる**。
最上位制約(基盤設計書から継承・不変): **週次運用30分以内 / ダミー生成禁止(未取得は `status:"未取得"`) / UIのフラット`factors`凍結 / 検証NG時は出力しない / 決定的処理(乱数・実行時LLM呼び出しは既定で使わない)**。

---

## 0. この設計書が基盤設計書のどこに入るか

基盤設計書のパイプラインは
`TARGET → Import → Normalization → factors.mjs → week-data.json → Frontend`
だった。本設計書は、そのうち **§7 `factors.mjs`(単純なfactor算出)を、9エンジンからなる Intelligence Layer に置き換える**。それ以外(§2ディレクトリ、§3スキーマ、§4featured、§5raceType、§6import、§9運用、§11リスク)は**そのまま生きる**。

```
… → Normalization → [AI Intelligence Layer] → week-data.json → Frontend
                         ├─ 8 Analyst Engines (Ability/Blood/Training/Course/Pace/Stable/Form/Value)
                         └─ Verdict Engine (8エンジンを統合し AI Verdict を出す)
```

**基盤設計書との接続点(Codexは必ずこの対応で実装):**
- 各エンジンの出力`score`は、基盤§3スキーマの `analysis.factorsDetail.{key}` にそのまま入る。
- 各エンジンの`score`のうちUIフラット互換が必要なものは、基盤の`analysis.factors`(9キー)へ写す(下表)。
- Verdict Engineの統合結果が、既存の `aiScore`(TM INDEX)/ `topSignal` / `analysis.confidence` / `commentary`の骨子を生成する。
- 「7つのAIが議論」の要望に対し、本設計は **8 Analyst + 1 Verdict = 9エンジン**構成とする(要望の列挙に沿い、Ability Engineを独立させた。呼称は「7 factor + Verdict」でも「8 analyst + Verdict」でも同一物)。

**エンジン↔既存factorsキー対応(凍結キーを壊さないための正表):**

| エンジン | factorsDetailキー | フラットfactorsキー(UI既読・不変) |
|---|---|---|
| Ability Engine | `ability` | `ability` |
| Course AI | `course` | `course` |
| (距離はCourse AI内で算出) | `distance` | `distance` |
| Pace AI | `pace` | `pace` |
| Training AI | `training` | `training`, `trainingLap` |
| Blood AI | `blood` | `pedigree`(派生表示), `stable`は別 |
| Stable AI | `stable` | `stable` |
| Form AI | `form` | (新規・フラットには出さずdetailのみ) |
| Value AI | `value` | (既存ValueCard/EVが担当。detailに追加) |
| Verdict Engine | — | `aiScore`, `frame`(枠はPace AI入力) |

> 重要: `factors`のフラット9キー(ability/course/distance/pace/lap/training/trainingLap/stable/frame + pedigree派生)は**UIが読んでいるので削除・改名しない**。Form/ValueのようにUIにまだ出さないものは`factorsDetail`のみに置く(基盤§3の方針どおり「足すだけ」)。

---

## 1. 全エンジン共通仕様(Codexはこの契約を全エンジンで厳守)

**1-1. 共通インターフェース(全エンジン同一シグネチャ)**
- 入力: `(horse, raceContext, masters)` の3引数。
  - `horse`: normalize済みの1頭(raw各種・pastRuns・trainingSessions・血統・調教師名など)。
  - `raceContext`: レース情報 + **同一レース全出走馬の配列**(相対評価に必須) + courses.json該当エントリ。
  - `masters`: `data/master/` 一式(stables/courses/bloodlines/race-aliases)。
- 出力: **必ず** 次の形。
```jsonc
{ "score": 0-100,             // 決定的に算出。未取得時は中立値(既定60)
  "confidence": "high|mid|low",
  "reason": "一文。必ず実測値を含む(形容だけ禁止)",
  "signals": ["短文0-3。各々が数値/事実の裏付けを持つ"],
  "status": "ok|部分|未取得",  // データ充足度
  "inputs": { /* 使った実測値の記録(監査・将来学習用) */ } }
```

**1-2. 3つの鉄則(基盤から継承):**
1. **ダミー禁止**: 入力が無ければ`status:"未取得"`, `confidence:"low"`, `score`=中立、`reason`に「◯◯データ未取得」。値を捏造しない。
2. **実測値主義**: `reason`と`signals`は必ず具体値(`4F51.3-1F11.9`, `同コース3走`, `EV1.28`)を含む。「動きが良い」等の裸の形容は禁止。
3. **決定性**: 同じ入力から同じ出力(MVP/v1)。実行時にLLMやAPIを叩かない。将来のAI学習は「オフラインで係数/テーブルを更新し、実行時は決定的に引く」形にする(§13)。

**1-3. 監査ログ**: 各エンジンは`inputs`に採点根拠の生値を残す。これが将来のAI学習(§13)の教師データになり、`data/archive/`へweek-dataごと保存される(基盤§8 Stage3の器を流用)。

---

## 2. Ability Engine

- **役割**: 純粋な能力値。TM INDEXの土台で最大重み。
- **入力**: TARGETスピード指数(第一)、無ければ pastRuns の着順・着差・頭数・クラス。
- **出力**: 共通契約。`score`=能力、`signals`例「指数127はメンバー首位」。
- **score算出**: 指数ありは**レース内順位を92→56に正規化**(既存実装踏襲)。指数なしは前走(着順/頭数の相対 − 着差×係数)で推定し上限88。クラス格差補正(昇級−、降級+)を±3で加える。
- **confidence**: 指数あり=high / 前走推定=mid / 前走も無し=low。
- **reason**: 「スピード指数127でレース内1位(2位比+4)」等。
- **signals**: 指数首位/僅差群/指数と着順の乖離(能力あるが着順悪い=展開不利の示唆)。
- **他AIとの連携**: Form AIへ「指数トレンドの生値」を渡す。Value AIはAbilityのscoreから勝率を推定。
- **将来AI化**: 指数→着順の残差(能力はあるのに負けた要因)を回帰し、「不利補正済み能力」を学習(§13-A)。

---

## 3. Blood AI(重点)

- **役割**: 血統を「今回の条件に対する適性ベクトル」へ変換する。単なる父評価ではない。
- **入力**:
  - 血統: 父 / 母 / 母父 / 母の母(TARGET出馬表)。
  - 条件: 距離・コース(場×芝ダ×距離)・**右左回り**・馬場(良〜不良)・**季節(開催月)**・開催(元気な時期か)。
  - 産駒データ: `data/master/bloodlines.json`(下記)。
  - 自馬の成長段階: 馬齢・キャリア数(pastRuns数)。
- **出力**: `score`=総合血統適性、`signals`例「父ロードカナロア×芝1200は主流」「母父サクラバクシンオーで短縮対応」。加えて **9項目ベクトル**(既存pedigree.scores: course/distance/going/lap/family/speed/stamina/burst/sustain)を維持出力。
- **bloodlines.json スキーマ(masters・育てる資産):**
```jsonc
{ "schemaVersion": 1,
  "sires": {
    "ロードカナロア": {
      "type": "speed",                       // speed|mile|middle|stamina|dirt|versatile
      "aptitude": { "surface": {"芝":+6,"ダ":+2}, "distanceRange":[1000,1800],
                    "turn": {"右":0,"左":+2}, "going": {"良":+3,"重":-2},
                    "season": {"summer":+2} },
      "growth": "early",                      // early|normal|late
      "note": "芝短距離〜マイルの主流スピード。産駒は完成が早い",
      "confidence": "high", "source": "manual|learned" },
    "…": {}
  },
  "damSires": { "サクラバクシンオー": { "reinforce": {"speed":+3,"distanceShort":+4}, "note":"短距離を強く補強" } },
  "crosses": { "ロードカナロア×Danzig系": { "note":"スピード強化のニックス", "bonus":+2 } }  // 将来学習で拡張
}
```
- **score算出**: 基準=既存9項目平均。そこへ bloodlines.json の父`aptitude`(今回の距離/コース/回り/馬場/季節に対する加点)と母父`reinforce`を合算。**成長曲線**: growth="late"×馬齢若=−、="early"×高齢=横ばい、で±3。**未登録種牡馬**は既存の系統推定(名前パターン→type)にフォールバックし confidence を下げる。
- **confidence**: 父・母父ともDB登録=high / 片方=mid / 未登録or血統未取得=low。
- **reason**: 「父ロードカナロア(芝短距離主流,+6)×母父サクラバクシンオー(短縮+4)。福島芝1200・夏開催に適合」。
- **signals**: 主流/異端、距離短縮延長への血統的裏付け、道悪巧者(母父の going 補正)、夏に強い血統。
- **他AIとの連携**: Course AI(血統がコース傾向と合うか)、Pace AI(スピード血統は先行示唆)、Training AIへは干渉しない。
- **将来AI化(重点・§13-B)**: 過去5〜10年の(種牡馬×コース×距離×馬場×季節→着別度数/複勝率)を集計し、`aptitude`の数値を**手入力ではなく学習値**に置換。実行時は学習済みテーブルを決定的に引くだけ(重い計算はオフライン)。母父ニックス(`crosses`)も同様に度数から自動抽出→人間承認でDB追記。

---

## 4. Training AI(最重点)

**単なる時計評価は禁止。厩舎の勝負調教パターンを核とする。ただし全厩舎手入力は禁止。**
基盤§8の3段階を継承し、本設計で各Stageの入出力と学習構造を精密化する。

- **役割**: 「この厩舎がこの馬を勝負仕上げにしてきたか」を、時計・パターン照合・相対評価で判定する。
- **入力**: trainingSessions(全45日、累計→4F/Lap4-1F/コース/日付/phase)、調教師名、出走間隔、`data/master/stables.json`、**同レース全馬の調教**(相対評価用)。

**Stage 1 — 共通ロジック(実装済み+強化):**
- 既存: 累計→4F/Lap算出、最終(≤4日)/一週前(5-12日)/中間分類、窓内最速代表、コース別終い1F基準、加速ラップ、本数、休み明けcap。
- 強化A(同週相対): 同レース全馬の一週前代表を**コース種別ごとに時計順**にし、上位20%へ`signal:"今週の追い切り上位"`。馬場差を吸収。
- 強化B(自己ベスト比): その馬の`raw.trainingSessions`過去分と比べ、今回の一週前が自己ベスト圏なら`signal:"自己ベスト級の時計"`。

**Stage 2 — 主要厩舎DB(stables.json・スキーマ拡張):**
```jsonc
{ "schemaVersion": 2,
  "stables": [{
    "name": "中内田充正", "trainingCenter": "栗東",
    "winningPattern": {                        // 勝負仕上げの型(ANDで照合)
      "phase":"一週前", "course":["CW"], "time4FMax":52.5, "last1FMax":11.8,
      "accel":true, "minCount":5, "withCompanion":true },
    "signaturePhrase": "一週前CWで併せて鋭い時計",
    "sampleSize": 0,                           // 学習時の根拠本数(manualは0)
    "hitRate": null,                           // 学習後: このパターン時の複勝率
    "source":"manual", "confidence":"high" }] }
```
- **判定エンジン**: winningPatternの各条件をsessionsにANDで評価 → 合致度(満たした条件数/全条件)を0-1で出し、`trainingEval.stablePattern = { match:bool, degree:0-1, status:"照合済", text: signaturePhrase+実測値 }`。degreeをscoreに+反映。
- **DB未登録厩舎**: `status:"DB未登録"`。Stage1の時計評価(A/B→合致仮判定)を「仮判定」明記で継続。**空DBでも全馬動く**。
- **運用ルール(30分厳守)**: 手入力は必須にしない。「featuredRaceに出た厩舎だけ、AI提案(§Stage3)を承認して週2-3件追記」を**任意タスク**に。全厩舎手入力は禁止。

**Stage 3 — AIによる勝負調教パターン抽出(学習構造・本設計の主眼):**
- **教師データ**: `data/archive/*.json`(週次week-data全体)に、後日 `raw.review`(着順)を追記して蓄積。1年で約3,000〜4,000頭分。
- **抽出ジョブ(オフライン `tools/learn/extract-stable-patterns.mjs`・実行は月1回など任意)**:
  1. archiveを横断し (調教師 × sessionsの特徴量: phase/コース/4F/終い1F/加速/併せ/本数) を集計。
  2. 各厩舎で「複勝圏内だった時に共通する調教特徴」を度数・複勝率で抽出(最低sampleSize閾値、例20)。
  3. 閾値を超えたパターンを `winningPattern`(sampleSize/hitRate付き)として **stables.learned.json** に書き出す。
  4. 人間は差分を見て承認したものを `stables.json` にmerge(**自動書き換え禁止**・commit=承認)。
- **実行時**: 学習済みwinningPatternを**決定的に照合するだけ**(重い集計はオフライン)。→ 30分運用を壊さない。
- **将来**: LLMを「抽出結果の自然言語要約(signaturePhrase生成)」に限定使用(実行時ではなくオフライン)。

- **score算出**: Stage1(時計・相対・自己ベスト)base + Stage2/3のstablePattern degree×係数。
- **confidence**: 一週前実測あり&(DB照合 or 十分な本数)=high / 時計のみ=mid / 調教未取得=low。
- **reason**: 「一週前坂路4F51.3-1F11.9(加速)。中内田厩舎の勝負パターンに合致(複勝率○%,n=○)」。学習前は「(パターン仮判定)」。
- **signals**: 加速ラップ / 今週上位 / 自己ベスト / 厩舎勝負合致 / 乗り込み豊富 / 休み明け割引。
- **他AIとの連携**: Form AI(調教トレンド)、Stable AI(厩舎の使い方全体)、Verdict(勝負気配の重み上げ)。

---

## 5. Course AI

- **役割**: コース特性・開催傾向・馬場傾向に対する適性(距離適性もここで統合算出)。
- **入力**: pastRuns(同コースコード数・芝ダ一致・距離差)、`courses.json`(traits/keyFactor/bias)、当該レースの馬場、Blood AIの適性ベクトル(連携)。
- **courses.json**(基盤§7-3を拡張):
```jsonc
{ "福島-芝-2000": { "traits":"小回り・起伏。先行有利で内枠やや有利", "keyFactor":["pace","stamina"],
                    "bias":"前・内", "biasByGoing": {"重":"さらに前有利"} } }
```
- **出力**: `course`(適性)と`distance`(距離適性)を別scoreで(両方factorsDetailへ)。
- **score算出**: 66 + 同コース×6 + 芝ダ一致 + traits.keyFactorと自馬の強み(Blood/Paceのタイプ)合致±4。距離は 84 − 距離差/200×5 + 同距離×1.5。
- **confidence**: 同コース経験≥2=high / traitsあり距離実績ありmid / どちらも無し=low。
- **reason**: 「福島芝2000は先行・内有利。同コース3走・同距離2走」。
- **signals**: コース巧者(同3走以上)/ 初コース割引 / 距離延長短縮 / 馬場悪化で持ち味増減。
- **他AIとの連携**: Pace AI(biasは展開の前提)、Blood AI(血統がコース傾向に一致で相互加点)。
- **将来AI化**: courses.jsonのtrait/biasを、過去の(枠×脚質×コース→複勝率)集計から学習(§13-C)。

---

## 6. Pace AI

- **役割**: 脚質評価に留めず、**レース全体の展開シミュレーション**を行い、各馬の展開利/不利を出す。
- **入力**: 全出走馬の脚質(未取得馬は血統/前走通過順から推定)、枠、距離、コースbias、頭数。
- **処理内容(展開シミュレーション・決定的)**:
  1. 各馬の脚質を{逃/先/差/追}に分類(未取得は Blood(スピード型→前)・pastRunsの通過順平均から推定、confidence下げる)。
  2. **想定隊列**を構築: 逃げ頭数→ペース想定(逃げ0-1=スロー / 2-3=平均 / 4+=ハイ)。
  3. ペース×各馬脚質×枠×コースbiasで展開利を採点(例: ハイペース→差し追込に+、スロー→逃げ先行に+)。
- **出力**: `pace`(展開利)。`raceContext`に`paceScenario`(想定ペース・隊列)を1つ書き、VerdictとdailySummaryが参照。
- **score算出**: 脚質基準(逃80/先78/差72/追66)+ペース適合±6 + 枠×コースbias±4。
- **confidence**: 脚質実測が過半数=high / 推定多い=mid / ほぼ推定=low。
- **reason**: 「逃げ2・先行4でペースは平均想定。先行力ある内枠で展開利」。
- **signals**: ハイペース瓦解の差し台頭 / 単騎逃げの利 / 前壁リスク / 展開が全て(脚質×ペース依存大)。
- **他AIとの連携**: Course(bias)/Form(先行力の維持)/Verdict(混戦度=展開依存度をconfidenceへ)。
- **将来AI化**: 隊列→実ラップの誤差を学習し、ペース判定閾値を場・距離別に最適化(§13-D)。

---

## 7. Stable AI

- **役割**: 厩舎の**使い方全体**(ローテ・輸送・仕上げ本気度・騎手起用)を評価。Training AI(調教の中身)より上位の「陣営の意図」。
- **入力**: 調教師名・stables.json、出走間隔(intervalWeeks)、輸送有無(trainingCenterと開催場の距離)、乗り替わり/主戦継続(騎手×過去騎乗)、格(重賞かステップか)。
- **処理内容**: ①ローテ評価(叩き○戦目/連闘/休み明けをintervalとpastRunsから)。②輸送(栗東馬の関東遠征等=−小)。③騎手(主戦継続+/テン乗り±/強化騎乗+)。④勝負度(重賞に主戦+勝負調教=陣営本気)。
- **出力**: `stable`。
- **score算出**: 基準70 + ローテ適正±5 + 輸送±3 + 騎手±4 + 勝負度+(Training AIのstablePattern degree連動)。
- **confidence**: 調教師・騎手取得済=high / 一部欠落=mid / 未取得=low。
- **reason**: 「中2週の叩き2戦目・主戦継続・栗東から福島輸送」。
- **signals**: 勝負ローテ/乗り替わり強化/テン乗り不安/輸送減/連闘の消耗。
- **他AIとの連携**: Training(調教)/Form(ローテと調子)/Verdict。
- **将来AI化**: 厩舎×ローテパターン×複勝率、騎手×コース成績を学習(§13-E)。

---

## 8. Form AI

- **役割**: 近走成績の羅列でなく、**調子の方向(上昇/ピーク/下降)と成長段階**を判定。
- **入力**: pastRuns(着順・着差・指数の時系列)、馬齢・キャリア数、休養(interval)、馬体重増減(取得時)、今回の調教トレンド(Training連携)。
- **処理内容**: ①指数/着差の直近3-5走の傾き(回帰)で上昇・下降。②ピーク検出(直近が自己最高指数圏か)。③成長(若馬×指数上昇=成長期、高齢×下降=ピークアウト)。④休み明けの実績(過去の休み明け成績)。
- **出力**: `form`(factorsDetailのみ、UIフラット未使用)。
- **score算出**: 基準65 + トレンド傾き±10 + ピーク圏+5 + 休み明け不振歴−。
- **confidence**: pastRuns≥4=high / 2-3=mid / 1以下=low。
- **reason**: 「直近3走の指数が右肩上がり(112→119→127)。上昇カーブ」。
- **signals**: 上昇カーブ/ピーク/ピークアウト/叩き上昇/休み明け不振傾向/馬体増減。
- **他AIとの連携**: Ability(指数生値)/Training(調教の上向き)/Value(調子↑で過小人気は妙味)。
- **将来AI化**: 「上昇カーブ×次走好走率」を学習し傾き閾値を最適化(§13-F)。

---

## 9. Value AI

- **役割**: 期待値に留めず、**AI推定勝率 と 市場(オッズ/人気)のズレ**を評価。TURF MATRIXの主張「人気ではなく期待値」の担い手。
- **入力**: Verdict前段の各エンジンscore(→AI勝率)、単勝オッズ、人気。
- **処理内容**: ①AI勝率 = Verdictの統合score(またはAbility中心の暫定score)をsoftmax(既存k=7)。②EV = AI勝率×オッズ。③**市場乖離** = AI順位 − 人気順位。④過剰人気/過小評価の判定。
- **出力**: `value`(factorsDetail)+ 既存EV/TM VALUE(ValueCard)。
- **score算出**: min(99, EV×50)。乖離ボーナス(AI上位×人気薄)を signals に。
- **confidence**: オッズ実測=high / 概算(--force)=low。
- **reason**: 「AI勝率18%×オッズ7.9=EV1.42。AI3位に対し7人気」。
- **signals**: 妙味(EV≥1.15)/過剰人気(EV<0.9)/AIと市場の大乖離/ヒモ妙味。
- **他AIとの連携**: **Verdict確定後に最終計算**(順序依存: Value は最後)。Form(調子↑×人気薄で妙味増)。
- **将来AI化**: AI勝率の較正(予測勝率と実際の勝率のcalibration)を学習し過信を補正(§13-G)。

---

## 10. Verdict Engine(統合)

- **役割**: 8エンジンを統合し、TM INDEX(aiScore)・AI Verdict(最終見解)・confidence・evidence・summaryを生成。
- **入力**: 8エンジンの{score,confidence,signals,status}。
- **10-1. 重み付け(レース条件で動的・決定的):**
  - 基本重み(合計1.0): Ability .26 / Training .16 / Course .12 / Blood .10 / Pace .12 / Form .10 / Stable .08 / Value .06(※ValueはVerdict後に再計算するため統合scoreには低め、表示は別)。
  - **条件別調整**: 距離短縮延長週→Blood+/ 重馬場→Blood(道悪)+Course+/ 少頭数→Pace−/ 多頭数&紛れ→Pace+/ 休み明け多数→Training+Form+。調整は各±0.04以内、正規化して合計1.0維持。
- **10-2. score統合**: 各エンジンscoreの加重平均 → `aiScore`(TM INDEX, 50-96にクリップ)。
- **10-3. confidence統合**: 重み上位4エンジンのconfidenceを多数決+data統合。low多数or主要エンジン未取得なら全体low。→ `analysis.confidence` と `confidenceReasons`(各エンジンのlow理由を集約)。
- **10-4. evidence**: 各エンジンの最強signal 1つずつを集め、重み降順に3-5件 → `analysis.insight`/`pros`の骨子。矛盾検出(例: Ability高×Form下降)は`cons`へ「能力上位も調子は下降(112→127→119)」。
- **10-5. topSignal**: 8エンジンのうち **(重み×confidence×signalの強さ)最大**の1つを`topSignal`に(基盤§7-4の決定的規則を、エンジン横断の統一ルールへ格上げ)。
- **10-6. summary / Final Verdict**: `commentary`(100-160字)の骨子を、重み上位3エンジンのreasonを接続して生成(テンプレート)。`dailySummary`はfeaturedRace中心に、Pace AIの`paceScenario`+上位馬のVerdictで構成。
- **10-7. AI Verdict ラベル**(新規・factorsDetailと別に `analysis.verdict`):
```jsonc
"verdict": { "stance":"本命|対抗|妙味|警戒|消し", "headline":"一文の結論",
             "topFactors":["training","value"], "confidence":"high" }
```
  stanceは決定的閾値(aiScore順位 × EV × confidence)で決める。UI表示は将来(MVPはデータのみ)。
- **将来AI化**: 重みを固定でなく「各factorのscore→実着順」を学習した回帰係数に置換(§13-H)。**説明可能性維持のため線形モデル(各factorの寄与が見える)を採用**、ブラックボックス化しない。

---

## 11. ディレクトリ / ファイル構成(基盤§2への追加分のみ)

```
tools/
  intelligence/                     # ★AI Intelligence Layer(本設計)
    index.mjs                       # runIntelligence(horse, raceContext, masters) → analysis一式
    engines/
      ability.mjs  blood.mjs  training.mjs  course.mjs
      pace.mjs     stable.mjs form.mjs      value.mjs
    verdict.mjs                     # 8エンジン統合 → aiScore/verdict/topSignal/insight骨子
    weights.mjs                     # 基本重み+条件別調整(決定的)
    contracts.mjs                   # 共通出力の型チェック(score範囲/confidence値/reason非空)
  learn/                            # ★オフライン学習(v2・実行時に呼ばない)
    extract-stable-patterns.mjs     # archive→stables.learned.json
    extract-blood-aptitude.mjs      # archive→bloodlines.learned.json
    build-course-bias.mjs           # archive→courses.learned.json
  lib/factors.mjs                   # ← 基盤の単純factorをintelligence/index呼び出しへ置換
data/master/
  stables.json      # 拡張(§4)   stables.learned.json    # 学習出力(承認前)
  bloodlines.json   # 新規(§3)   bloodlines.learned.json
  courses.json      # 拡張(§5)   courses.learned.json
```

**接続**: 基盤の`factors.mjs`は、正規化済みhorseを受け取り`tools/intelligence/index.mjs`を呼び、返ってきた`factorsDetail`/`factors`/`aiScore`/`verdict`/`topSignal`/`insight`等をweek-dataの`analysis`へ書くだけの薄いアダプタになる。**基盤の他モジュール(parse/normalize/select-featured/validate)は不変。**

---

## 12. 実装ロードマップ(MVP → v1 → v2)

### MVP(七夕賞まで・6日) — 「9エンジンの骨格が動き、既存と回帰しない」
目標: 全エンジンが共通契約で`factorsDetail`を出し、Verdictが`aiScore`を統合生成。**UIは触らない(データのみ)。既存のaiScoreと大きくずれないこと**。

- M1. `tools/intelligence/` 雛形 + `contracts.mjs`(型チェック) + `weights.mjs`(基本重みのみ)。
- M2. 既存csv-to-week内のfactor算出ロジックを **engines/{ability,course,pace,training,blood}.mjs へ移設**(挙動不変で共通契約に包む)。distance は course.mjs 内。
- M3. **stable.mjs / form.mjs / value.mjs を新規**(最小: Stableは間隔+騎手継続、Formは指数傾き、ValueはEV)。
- M4. `verdict.mjs`: 加重平均でaiScore、confidence多数決、topSignal横断ルール、insight骨子。**既存aiScoreとの差を検証**(北九州データで±3以内に収まるよう基本重みを較正)。
- M5. `factorsDetail`/`verdict`/`topSignal`をweek-dataへ出力。lib-validateに「存在時のみ型チェック」を追加(基盤タスク8と統合)。
- M6. bloodlines.json/courses.json/stables.json に**七夕賞・福島週の最小シード**(主要種牡馬10・福島コース5・featured想定厩舎3-5)。
- M7. 北九州で回帰テスト(aiScore差±3)→七夕賞実データで通し→ERROR0→push。
- **MVPで実装しない**: 学習ジョブ(tools/learn)、展開シミュレーションの精緻化、UI表示、AI Verdictラベルの画面表示。

受入: `npm run verify`成功 / 既存表示が壊れない / factorsDetailに8エンジン分が入る / 未取得エンジンが`status:"未取得"`で正しく縮退。

### v1(公開後1-2ヶ月) — 「AIらしさをUIに出す・分析を深める」
- V1-1. UI: factorsDetailのreason/signalsを馬詳細に表示(比較テーブルの各factorにホバー根拠)。topSignalをRace Card/BottomSheetに。**世界観維持**(白基調・静か)。
- V1-2. AI Verdictラベル(stance/headline)をBottomSheetに控えめ表示。
- V1-3. Pace AI 展開シミュレーション本実装(想定隊列図をdailySummaryに1行+将来SVG)。
- V1-4. Blood AI: bloodlines.json拡充(種牡馬50+)、母父reinforce・crosses対応。
- V1-5. Training Stage2: stables.json主要50厩舎を**AI提案(手集計)→承認**で育て始める。
- V1-6. `data/archive/`へreview(着順・払戻)を追記する運用と、回顧(的中/回収率透明化)ページの器。
- V1-7. weights条件別調整の有効化(距離替わり週・道悪週で体感が変わる)。

受入: 主要factorのreasonが全馬で数値付き / 展開想定がレース単位で出る / archiveにreview蓄積開始。

### v2(3ヶ月〜・競合が真似できない領域) — 「学習で自走する」
- V2-1. **tools/learn 稼働**: archive 6ヶ月分から extract-stable-patterns → stables.learned.json、人間承認mergeのループ確立。
- V2-2. extract-blood-aptitude: 種牡馬×条件×複勝率を学習し bloodlines.json の aptitude を学習値化(§13-B)。
- V2-3. build-course-bias: 枠×脚質×コース→有利度を学習し courses.json のbias更新(§13-C)。
- V2-4. Verdict重みを**線形回帰で学習**(各factor→着順)。説明可能性維持のため係数を公開・monotonic制約。
- V2-5. Value AI calibration(予測勝率の較正)で過信補正。
- V2-6. 学習の月次バッチ化(GitHub Actions等・オフライン)。実行時は決定的テーブル参照のまま=**30分運用不変**。

受入: 学習出力が人間承認で本番反映される回路が回る / 実行時性能は不変 / 各学習値にsampleSize/hitRateの根拠が付く。

---

## 13. 「実行時は決定的・学習はオフライン」原則(全AI化の共通設計)

競合が真似できず、かつ30分運用を壊さない鍵。**実行時(週次import)は一切学習しない**。

| # | 学習ジョブ(オフライン・任意頻度) | 入力 | 出力(承認後mergeで本番反映) |
|---|---|---|---|
| A | Ability残差学習 | archive: 指数vs着順 | 不利補正係数 |
| B | Blood適性学習(重点) | 種牡馬×コース×距離×馬場×季節→複勝率 | bloodlines.json.aptitude |
| C | Courseバイアス学習 | 枠×脚質×コース→複勝率 | courses.json.bias |
| D | Paceペース閾値学習 | 隊列想定vs実ラップ | ペース判定閾値 |
| E | Stableローテ学習 | 厩舎×ローテ×複勝率 | stable係数 |
| F | Formトレンド学習 | 上昇カーブ×次走好走率 | 傾き閾値 |
| G | Value較正 | 予測勝率vs実勝率 | calibration曲線 |
| H | Verdict重み学習 | 全factor×着順 | weights(線形・説明可能) |

共通ルール: **自動で本番stables/bloodlines/coursesを書き換えない**。学習は`*.learned.json`に出し、人間がdiffを見てcommit(=承認)。各学習値に`sampleSize`と`hitRate`を必須付与し、根拠の薄い学習値は採用しない。教師データ`data/archive/`はJRA-VAN由来のため**private管理**(基盤§11-R0)。

---

## 14. Codex実装の共通Done定義(全Step)
- `npm run verify`(validate + vite build)成功。
- 既存UI表示が回帰しない(フラット`factors`・aiScoreの互換)。
- 全エンジンが§1共通契約(score/confidence/reason/signals/status/inputs)を返し、`contracts.mjs`の型チェックを通る。
- データ未取得エンジンが`status:"未取得"`で縮退し、ダミー値を出さない。
- 追加ファイルが§11構成に一致。学習ジョブ(tools/learn)は実行時パイプラインから呼ばれない。

— 以上。迷ったら基盤設計書の原則(「30分運用を壊さない/ダミーを作らない/UIを触らない/決定的」)に従うこと。Intelligence Layerの価値は"実行時の賢さ"ではなく"オフライン学習の蓄積を決定的に引く構造"にある。
