import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles, Zap, Ruler, Activity, Dumbbell, Timer, Home, LayoutGrid, Dna,
  TrendingUp, MessageSquare, Clock, BadgeCheck, ChevronDown, ChevronLeft, X,
  Star, Map, Route, ChevronRight,
} from "lucide-react";

/* =====================================================================
 * TURF MATRIX β (v0.3) — AI Racing Intelligence Platform
 * ---------------------------------------------------------------------
 * ■ 3層完全分離(毎週の運営はデータ層だけを触る):
 *
 *   [DATA]  WEEK_DATA        … 週次データ。マーカー間を丸ごと差し替えるだけ。
 *                              手動貼り付け or `node update-data.mjs` で注入。
 *   [LOGIC] lib/logic        … 期待値・推定勝率・血統指数・Rank・信頼度など
 *                              全て純関数。データから毎回自動計算(手入力不要)。
 *   [UI]    components/pages … データ形式にのみ依存。毎週触らない。
 *
 * ■ 運用フロー(READMEに詳細):
 *   JRA-VAN Data Lab. → (Claude/任意ツールで整形) → week-data.json
 *     → node update-data.mjs → デプロイ
 *
 * ■ 自動計算される項目(JSONに書く必要がない):
 *   期待値 / 推定勝率 / レース内Rank / S〜Dティア / 血統指数 /
 *   レース単位の分析信頼度 / トップの分析頭数・レース数
 * ===================================================================== */

/* =====================================================================
 * [1] lib/types — 型定義(JSDoc)
 * ---------------------------------------------------------------------
 * @typedef {Object} Factor        ファクター指数 (0-100)
 *   ability 能力 / distance 距離適性 / lap ラップ適性 / training 調教 /
 *   trainingLap 調教ラップ / stable 厩舎勝負調教パターン / frame 枠順
 *
 * @typedef {Object} PedigreeLine  { role, name, note }  4ライン(父系/母父系/母母父系/牝系)
 * @typedef {Object} Pedigree
 *   @property {PedigreeLine[]} lines
 *   @property {Object} scores  … course/distance/going/lap/family/speed/stamina/burst/sustain (0-100)
 *
 * @typedef {Object} TrainingEval
 *   grade A-D / oneWeek{score,text}(主要評価) / final{status,text}(確認材料) /
 *   stablePattern{match,text}
 *
 * @typedef {Object} Analysis
 *   tags[] / factors / pros[] / cons[] / insight[](3行) / commentary /
 *   frameEval{score,text} / trainingEval / pedigree / confidence high|mid|low
 *
 * @typedef {Object} Horse
 *   id / number / name / jockey / popularity / odds / aiScore / comment / analysis
 *
 * @typedef {Object} Race
 *   id / track / number / name / grade? / time / surface / distance /
 *   going / fieldSize / horses[]
 *
 * 将来拡張(スキーマ予約): RaceArchive { raceId, analyzedAt, result, review, roiNote }
 *   … 検証・回顧・回収率の透明化に使用
 * ===================================================================== */

/* ===== WEEK_DATA:BEGIN (このブロックを差し替え) ===== */
const WEEK_DATA = {
  "meta": {
    "date": "2026-07-05",
    "dateLabel": "7月5日(日)",
    "venue": "小倉",
    "updatedAt": "05:30",
    "version": "β v0.3",
    "brand": "TURF MATRIX",
    "schemaVersion": 3,
    "week": "2026-W27",
    "source": "target-frontier-jv-csv",
    "textMode": "edited",
    "inputProfile": "target-shutuba-noheader-46"
  },
  "dailySummary": {
    "text": "北九州記念の構図は明快です。TARGET指数はフリッカージャブ127・デアヴェローチェ126が拮抗し、調教まで織り込んだTM INDEXでは直前のCWで鋭く動いたデアヴェローチェが僅差の最上位。一方で指数3位のサウンドモリアーナは7人気に置かれ、市場との乖離が最大です。人気ではなく期待値で見るなら、中心は3列目にいます。",
    "highlights": [
      "TM INDEX最上位: デアヴェローチェ(84) / フリッカージャブ(84) — 上位2頭は調教込みでも互角",
      "期待値の中心: サウンドモリアーナ — 指数3位・調教6本に対して7人気、EV1.28",
      "一発枠: イツモニコニコ(前走0.3秒差でEV1.9台) / オタルエバー(小倉4走の実績でEV1.5台)"
    ]
  },
  "races": [
    {
      "id": "kokura-11",
      "track": "小倉",
      "number": 11,
      "name": "北九州記念",
      "grade": "GⅢ",
      "time": "15:45",
      "surface": "芝",
      "distance": 1200,
      "going": "良",
      "fieldSize": 13,
      "horses": [
        {
          "id": "kokura11-01",
          "number": 1,
          "name": "ランフォーヴァウ",
          "jockey": "石川裕紀人",
          "popularity": 10,
          "odds": 20.2,
          "aiScore": 74,
          "comment": "1400以上からの短縮。1200は初挑戦",
          "analysis": {
            "tags": [
              "距離短縮",
              "初1200",
              "妙味"
            ],
            "factors": {
              "ability": 71,
              "course": 72,
              "distance": 79,
              "pace": 69,
              "lap": 75,
              "training": 75,
              "trainingLap": 83,
              "stable": 69,
              "frame": 78
            },
            "insight": [
              "過去7走は1400〜2000m。1200は初挑戦",
              "8週間隔で臨む思い切った距離短縮",
              "10人気20.2倍でEV1.17。条件が合えば妙味"
            ],
            "pros": [
              "中距離で揉まれた地力(最小0.3秒差)がある",
              "10人気まで評価を落とし期待値は妙味側"
            ],
            "cons": [
              "芝1200のテンの速さは完全に未知数",
              "序盤で置かれると短い直線では届かない"
            ],
            "commentary": "過去7走は1400〜2000mで、1200mは今回が初挑戦。下り坂スタートから前半3ハロンが速くなる小倉で序盤の流れに乗れるかがすべてです。追走できれば中距離仕込みの地力(最小0.3秒差)が活きる一方、置かれれば直線約293mでは巻き返せません。適性未知のぶん10人気・期待値1.17と価格には妙味が乗る、割り切り狙いの一頭です。",
            "frameEval": {
              "score": 78,
              "text": "13頭立ての1番枠。テンの速い小倉1200で内めの並びはロスなく先団の直後を追える利があります。"
            },
            "trainingEval": {
              "grade": "B",
              "oneWeek": {
                "score": 75,
                "text": "一週前は6/24に栗東坂路で4F52.4-1F12.6(ラップ 15.1-12.9-11.8-12.6)。まずまずの動きです"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F53.2-1F12.5(ラップ 14.8-13.3-12.6-12.5)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 7,
                "mid": 0,
                "note": "直近の登坂・追い切りは計7本(うち中間調整0本)。乗り込み量は豊富です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "ロードカナロア",
                  "note": "芝短距離〜マイルで実績豊富な一流スプリント血統"
                },
                {
                  "role": "母",
                  "name": "キネオダンサー",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "ディープインパクト",
                  "note": "瞬発力を補強する名血"
                },
                {
                  "role": "母の母",
                  "name": "オールアイキャンセイイズウァウ",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 73,
                "distance": 85,
                "going": 78,
                "lap": 72,
                "family": 97,
                "speed": 76,
                "stamina": 77,
                "burst": 76,
                "sustain": 77
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 54,
                "note": "指数10位 × 10人気 → 単勝期待値1.08"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 78,
                "note": "一週前追い切り × 間隔8週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 76,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 54,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 8,
            "speedIndex": 106,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "115",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 0.8,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "115",
                "track": null,
                "distance": 1600,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "115",
                "track": null,
                "distance": 1600,
                "surface": "芝",
                "margin": 0.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1600,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "195",
                "track": null,
                "distance": 2000,
                "surface": "芝",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "179",
                "track": null,
                "distance": 1800,
                "surface": "芝",
                "margin": 2.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "179",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 1.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 52.4,
                "last1F": 12.6,
                "laps": [
                  15.1,
                  12.9,
                  11.8,
                  12.6
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-26",
                "course": "栗東坂路",
                "time4F": 72.9,
                "last1F": 17.8,
                "laps": [
                  18.6,
                  17.9,
                  18.6,
                  17.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東坂路",
                "time4F": 63.7,
                "last1F": 16.1,
                "laps": [
                  16.9,
                  15.3,
                  15.4,
                  16.1
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東CW",
                "time4F": 55.4,
                "last1F": 12,
                "laps": [
                  16.5,
                  14.5,
                  12.4,
                  12
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東CW",
                "time4F": 62.6,
                "last1F": 15.2,
                "laps": [
                  17,
                  15.9,
                  14.5,
                  15.2
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 53.2,
                "last1F": 12.5,
                "laps": [
                  14.8,
                  13.3,
                  12.6,
                  12.5
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-03",
                "course": "栗東CW",
                "time4F": 67.9,
                "last1F": 15.4,
                "laps": [
                  19,
                  17.6,
                  15.9,
                  15.4
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 7,
            "damDam": "オールアイキャンセイイズウァウ",
            "review": null
          }
        },
        {
          "id": "kokura11-02",
          "number": 2,
          "name": "ジェニファー",
          "jockey": "田口貫太",
          "popularity": 8,
          "odds": 15.7,
          "aiScore": 76,
          "comment": "中1週の強行軍。平均0.5秒差の安定型",
          "analysis": {
            "tags": [
              "1200専業",
              "連闘",
              "堅実"
            ],
            "factors": {
              "ability": 74,
              "course": 66,
              "distance": 90,
              "pace": 69,
              "lap": 76,
              "training": 76,
              "trainingLap": 70,
              "stable": 69,
              "frame": 78
            },
            "insight": [
              "芝1200を7走、平均0.54秒差の安定感",
              "中1週の詰まった臨戦。余力面がリスク",
              "8人気15.7倍でEV1.11。押さえの妙味"
            ],
            "pros": [
              "平均着差0.54秒は上位勢に次ぐ堅実さ",
              "1200一本のローテで舞台不安が無い"
            ],
            "cons": [
              "中1週の連闘で消耗面に疑問が残る",
              "指数107は勝ち切るには一段足りない"
            ],
            "commentary": "芝1200を7走使われ平均0.54秒差と、崩れの少なさはデアヴェローチェに次ぐ水準。今回は中1週の詰まった臨戦で、勢いに乗るか消耗が出るかが評価の分かれ目です。指数107は7位相当ながら8人気・15.7倍まで売られており、期待値1.11とわずかに妙味側。頭までは重く見ますが、堅実さを買って押さえる価値はあると分析します。",
            "frameEval": {
              "score": 78,
              "text": "13頭立ての2番枠。テンの速い小倉1200で内めの並びはロスなく先団の直後を追える利があります。"
            },
            "trainingEval": {
              "grade": "B",
              "oneWeek": {
                "score": 76,
                "text": "一週前は6/24に栗東坂路で4F58.6-1F12.7(ラップ 16.8-15.2-13.9-12.7)。終いまで加速する好内容です"
              },
              "final": {
                "status": "未取得",
                "text": "最終追い切りのデータは未取得です(評価は一週前を主要材料としています)。"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 1,
                "mid": 0,
                "note": "直近の登坂・追い切りは計1本(うち中間調整0本)。乗り込み量は少なめです。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "アニマルキングダム",
                  "note": "米ダービー馬。パワーとスピードの米国血統"
                },
                {
                  "role": "母",
                  "name": "スイングサンデー",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "スペシャルウィーク",
                  "note": "底力を補強"
                },
                {
                  "role": "母の母",
                  "name": "スイングパイ",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 68,
                "distance": 93,
                "going": 79,
                "lap": 74,
                "family": 97,
                "speed": 74,
                "stamina": 91,
                "burst": 76,
                "sustain": 79
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 51,
                "note": "指数8位 × 8人気 → 単勝期待値1.01"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 78,
                "note": "一週前追い切り × 間隔1週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 74,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 55,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 1,
            "speedIndex": 107,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.2,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 58.6,
                "last1F": 12.7,
                "laps": [
                  16.8,
                  15.2,
                  13.9,
                  12.7
                ],
                "phase": "一週前",
                "eval": null
              }
            ],
            "trainingCount": 1,
            "damDam": "スイングパイ",
            "review": null
          }
        },
        {
          "id": "kokura11-03",
          "number": 3,
          "name": "プロトポロス",
          "jockey": "幸英明",
          "popularity": 13,
          "odds": 61.5,
          "aiScore": 72,
          "comment": "ダート中心の戦歴。芝替わりが全ての前提",
          "analysis": {
            "tags": [
              "芝替わり",
              "ダート実績"
            ],
            "factors": {
              "ability": 56,
              "course": 66,
              "distance": 86,
              "pace": 71,
              "lap": 76,
              "training": 93,
              "trainingLap": 89,
              "stable": 66,
              "frame": 80
            },
            "insight": [
              "過去7走中6走がダート。芝1200は初",
              "前走0.6秒差と内容自体は悪くない",
              "EV2.4は「芝が走れれば」が大前提"
            ],
            "pros": [
              "ダートでは前走0.6秒差と形になっている",
              "61.5倍まで売られ当たれば見返りは最大"
            ],
            "cons": [
              "芝の速い流れと上がりへの適性が白紙",
              "指数87はメンバー最下位"
            ],
            "commentary": "過去7走中6走がダートで、芝1200は事実上の初挑戦。ダートでは前走0.6秒差と形になっていますが、小倉芝の速い流れへの対応は白紙です。指数87は最下位で、期待値2.40という数字も「芝が走れれば」という大前提の上に成り立つもの。データ上は静観が妥当で、押さえるとしても最小限に留めるべきと分析します。",
            "frameEval": {
              "score": 80,
              "text": "13頭立ての3番枠。テンの速い小倉1200で内めの並びはロスなく先団の直後を追える利があります。"
            },
            "trainingEval": {
              "grade": "A",
              "oneWeek": {
                "score": 93,
                "text": "一週前は6/25に栗東CWで4F52.6-1F11.1(ラップ 16.1-14.3-11.1-11.1)。終いまで加速する好内容です"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東CWで4F53.5-1F11.6(ラップ 15.7-14.0-12.2-11.6)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 6,
                "mid": 0,
                "note": "直近の登坂・追い切りは計6本(うち中間調整0本)。乗り込み量は豊富です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "War Front",
                  "note": "米国の快速血統。芝ダート兼用のスピード"
                },
                {
                  "role": "母",
                  "name": "キャヴァルドレ",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "Sunday Break",
                  "note": "血統表より取得"
                },
                {
                  "role": "母の母",
                  "name": "Sweet Alabama",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 64,
                "distance": 89,
                "going": 71,
                "lap": 77,
                "family": 97,
                "speed": 65,
                "stamina": 81,
                "burst": 54,
                "sustain": 75
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 99,
                "note": "指数13位 × 13人気 → 単勝期待値2.71"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 87,
                "note": "一週前追い切り × 間隔10週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 71,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 53,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 10,
            "speedIndex": 87,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "115",
                "track": null,
                "distance": 1600,
                "surface": "ダ",
                "margin": 0.6,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "115",
                "track": null,
                "distance": 1400,
                "surface": "ダ",
                "margin": 1.2,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "131",
                "track": null,
                "distance": 1400,
                "surface": "ダ",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "ダ",
                "margin": 0.6,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1400,
                "surface": "ダ",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1400,
                "surface": "ダ",
                "margin": 1.2,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1600,
                "surface": "芝",
                "margin": 0.8,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 63.9,
                "last1F": 14.9,
                "laps": [
                  17.9,
                  16.3,
                  14.8,
                  14.9
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-25",
                "course": "栗東CW",
                "time4F": 52.6,
                "last1F": 11.1,
                "laps": [
                  16.1,
                  14.3,
                  11.1,
                  11.1
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東坂路",
                "time4F": 64,
                "last1F": 14.9,
                "laps": [
                  18,
                  16,
                  15.1,
                  14.9
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 59.2,
                "last1F": 14.4,
                "laps": [
                  16.1,
                  14.4,
                  14.3,
                  14.4
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 64,
                "last1F": 15.2,
                "laps": [
                  16.8,
                  16.3,
                  15.7,
                  15.2
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東CW",
                "time4F": 53.5,
                "last1F": 11.6,
                "laps": [
                  15.7,
                  14,
                  12.2,
                  11.6
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 6,
            "damDam": "Sweet Alabama",
            "review": null
          }
        },
        {
          "id": "kokura11-04",
          "number": 4,
          "name": "アンクルクロス",
          "jockey": "松若風馬",
          "popularity": 3,
          "odds": 7.4,
          "aiScore": 79,
          "comment": "1200専業も前走1.8秒差。人気先行気味",
          "analysis": {
            "tags": [
              "1200専業",
              "巻き返し"
            ],
            "factors": {
              "ability": 80,
              "course": 69,
              "distance": 90,
              "pace": 72,
              "lap": 69,
              "training": 87,
              "trainingLap": 83,
              "stable": 67,
              "frame": 76
            },
            "insight": [
              "過去7走すべて芝1200。舞台適性は証明済み",
              "前走1.8秒差の大敗をどう見るかが焦点",
              "3人気7.4倍でEV0.63。人気が先行気味"
            ],
            "pros": [
              "条件替わりの不安が無い1200専業の戦歴",
              "最小0.3秒差と噛み合えば上位の下地はある"
            ],
            "cons": [
              "前走1.8秒差は距離適性では説明できない大敗",
              "指数116に対し3人気は評価が先行している"
            ],
            "commentary": "過去7走すべて芝1200という専業で、小倉の速い流れ自体への不安はありません。焦点は前走の1.8秒差。度外視できる敗戦なら最小0.3秒差の水準まで巻き返せますが、指数は116で当メンバー5位相当に留まります。直前のCWでは4F51.1-1F11.0と鋭く動いており、状態の反転材料はあります。それでも3人気・単勝7.4倍は評価が先行気味で、期待値0.63は積極的に買う水準ではないと分析します。",
            "frameEval": {
              "score": 76,
              "text": "13頭立ての4番枠。テンの速い小倉1200で内めの並びはロスなく先団の直後を追える利があります。"
            },
            "trainingEval": {
              "grade": "A",
              "oneWeek": {
                "score": 87,
                "text": "一週前は6/28に栗東CWで4F59.5-1F11.8(ラップ 19.2-16.4-12.1-11.8)。終いまで加速する好内容です"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東CWで4F51.1-1F11.0(ラップ 15.3-13.4-11.4-11.0)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 5,
                "mid": 0,
                "note": "直近の登坂・追い切りは計5本(うち中間調整0本)。乗り込み量は標準です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "タリスマニック",
                  "note": "BCターフ勝ち馬。欧州芝の中距離型"
                },
                {
                  "role": "母",
                  "name": "ウインクルキラリ",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "ダンスインザダーク",
                  "note": "スタミナを補強"
                },
                {
                  "role": "母の母",
                  "name": "ウインクルグラス",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 69,
                "distance": 91,
                "going": 87,
                "lap": 72,
                "family": 97,
                "speed": 75,
                "stamina": 97,
                "burst": 80,
                "sustain": 74
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 31,
                "note": "指数4位 × 3人気 → 単勝期待値0.63"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 84,
                "note": "一週前追い切り × 間隔7週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 76,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 56,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 7,
            "speedIndex": 116,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.8,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "115",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.8,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.8,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 66.8,
                "last1F": 16.2,
                "laps": [
                  17.6,
                  16.8,
                  16.2,
                  16.2
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東坂路",
                "time4F": 72,
                "last1F": 17.2,
                "laps": [
                  19.8,
                  17.2,
                  17.8,
                  17.2
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": null,
                "course": "栗東坂路",
                "time4F": 66,
                "last1F": 15.8,
                "laps": [
                  18.1,
                  16.2,
                  15.9,
                  15.8
                ],
                "phase": "不明",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東CW",
                "time4F": 59.5,
                "last1F": 11.8,
                "laps": [
                  19.2,
                  16.4,
                  12.1,
                  11.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東CW",
                "time4F": 51.1,
                "last1F": 11,
                "laps": [
                  15.3,
                  13.4,
                  11.4,
                  11
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 5,
            "damDam": "ウインクルグラス",
            "review": null
          }
        },
        {
          "id": "kokura11-05",
          "number": 5,
          "name": "アブキールベイ",
          "jockey": "西村淳也",
          "popularity": 9,
          "odds": 16.2,
          "aiScore": 75,
          "comment": "小倉5走の経験馬も指数は下位圏",
          "analysis": {
            "tags": [
              "小倉経験"
            ],
            "factors": {
              "ability": 59,
              "course": 88,
              "distance": 90,
              "pace": 68,
              "lap": 75,
              "training": 93,
              "trainingLap": 89,
              "stable": 68,
              "frame": 71
            },
            "insight": [
              "小倉5走・芝1200を6走と条件経験は十分",
              "指数89は下位圏で能力面が課題",
              "9人気16.2倍でEV0.85。妙味は薄い"
            ],
            "pros": [
              "コース経験の厚さで流れには乗れる",
              "条件替わりの不安が無い"
            ],
            "cons": [
              "平均0.91秒差と勝ち負けまでの距離が遠い",
              "上位勢との能力差を埋める材料が無い"
            ],
            "commentary": "小倉5走・芝1200を6走と条件への習熟は申し分ないものの、指数89は下位圏で、平均0.91秒差という着差が現状の力関係を示しています。経験値で道中の流れには乗れても、直線で上位勢を逆転する根拠が見当たりません。9人気・期待値0.85と価格面の妙味も無く、今回は評価を上げる材料が揃わないと分析します。",
            "frameEval": {
              "score": 71,
              "text": "13頭立ての5番枠。中枠は序盤の位置取り次第でどちらにも転ぶ並びで、テンのダッシュ力が問われます。"
            },
            "trainingEval": {
              "grade": "A",
              "oneWeek": {
                "score": 93,
                "text": "一週前は6/24に栗東CWで4F51.8-1F11.5(ラップ 15.0-13.8-11.5-11.5)。終いまで加速する好内容です"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F53.7-1F12.2(ラップ 15.1-13.9-12.5-12.2)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 7,
                "mid": 0,
                "note": "直近の登坂・追い切りは計7本(うち中間調整0本)。乗り込み量は豊富です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "ファインニードル",
                  "note": "スプリントGI2勝馬。短距離のスピード血統"
                },
                {
                  "role": "母",
                  "name": "アゴベイ",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "ハーツクライ",
                  "note": "スタミナと成長力を補強"
                },
                {
                  "role": "母の母",
                  "name": "コージーベイ",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 89,
                "distance": 96,
                "going": 78,
                "lap": 72,
                "family": 97,
                "speed": 64,
                "stamina": 91,
                "burst": 60,
                "sustain": 77
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 48,
                "note": "指数9位 × 9人気 → 単勝期待値0.95"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 87,
                "note": "一週前追い切り × 間隔7週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 84,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 55.5,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 7,
            "speedIndex": 89,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.8,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.2,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "179",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東CW",
                "time4F": 51.8,
                "last1F": 11.5,
                "laps": [
                  15,
                  13.8,
                  11.5,
                  11.5
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-26",
                "course": "栗東坂路",
                "time4F": 65.6,
                "last1F": 15.8,
                "laps": [
                  17.2,
                  16.4,
                  16.2,
                  15.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東CW",
                "time4F": 71.7,
                "last1F": 17.8,
                "laps": [
                  18.2,
                  18.4,
                  17.3,
                  17.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 57.8,
                "last1F": 12.5,
                "laps": [
                  17.3,
                  15.1,
                  12.9,
                  12.5
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 63,
                "last1F": 15.8,
                "laps": [
                  15.8,
                  15.5,
                  15.9,
                  15.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 53.7,
                "last1F": 12.2,
                "laps": [
                  15.1,
                  13.9,
                  12.5,
                  12.2
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-03",
                "course": "栗東坂路",
                "time4F": 62.6,
                "last1F": 14.4,
                "laps": [
                  16.8,
                  15.8,
                  15.6,
                  14.4
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 7,
            "damDam": "コージーベイ",
            "review": null
          }
        },
        {
          "id": "kokura11-06",
          "number": 6,
          "name": "オタルエバー",
          "jockey": "角田大和",
          "popularity": 11,
          "odds": 29.2,
          "aiScore": 74,
          "comment": "小倉4走の実績馬。11人気は見切られ過ぎ",
          "analysis": {
            "tags": [
              "小倉巧者",
              "中穴妙味"
            ],
            "factors": {
              "ability": 65,
              "course": 87,
              "distance": 90,
              "pace": 72,
              "lap": 73,
              "training": 68,
              "trainingLap": 83,
              "stable": 67,
              "frame": 70
            },
            "insight": [
              "小倉4走・芝1200を6走と舞台経験が豊富",
              "指数95に対し11人気29.2倍まで下落",
              "EV1.87は数字上メンバー最上位級"
            ],
            "pros": [
              "得意条件に戻る一戦で一変の余地がある",
              "市場の見切りが指数の下げ幅より早い"
            ],
            "cons": [
              "前走1.1秒差など近走の着差は拡大傾向",
              "指数95で能力上位とは言えない"
            ],
            "commentary": "小倉4走・芝1200を6走と、この舞台に最も馴染みのある一頭。近走は1.1秒差など着差が広がり指数も95まで下げていますが、11人気・29.2倍という市場の見切りはそれ以上に早く、期待値は1.87まで開いています。能力最上位とは言えないものの、得意条件替わりの一変まで含めれば、紐の一角に加える価値のある中穴と分析します。",
            "frameEval": {
              "score": 70,
              "text": "13頭立ての6番枠。中枠は序盤の位置取り次第でどちらにも転ぶ並びで、テンのダッシュ力が問われます。"
            },
            "trainingEval": {
              "grade": "C",
              "oneWeek": {
                "score": 68,
                "text": "一週前は6/24に栗東坂路で4F51.3-1F13.3(ラップ 14.1-12.1-11.8-13.3)。終いは平凡な時計です"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F50.8-1F13.7(ラップ 13.1-11.9-12.1-13.7)。終いは平凡な時計です"
              },
              "stablePattern": {
                "match": false,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 5,
                "mid": 0,
                "note": "直近の登坂・追い切りは計5本(うち中間調整0本)。乗り込み量は標準です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "リオンディーズ",
                  "note": "キングカメハメハ系の万能型"
                },
                {
                  "role": "母",
                  "name": "ルージュクール",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "Redoute's Choice",
                  "note": "豪州の名スプリント・マイル血統"
                },
                {
                  "role": "母の母",
                  "name": "Sunday Valentine",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 87,
                "distance": 91,
                "going": 80,
                "lap": 76,
                "family": 97,
                "speed": 66,
                "stamina": 89,
                "burst": 65,
                "sustain": 74
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 78,
                "note": "指数11位 × 11人気 → 単勝期待値1.56"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 74,
                "note": "一週前追い切り × 間隔7週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 84,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 56,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 7,
            "speedIndex": 95,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 2.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "115",
                "track": null,
                "distance": 1200,
                "surface": "ダ",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 51.3,
                "last1F": 13.3,
                "laps": [
                  14.1,
                  12.1,
                  11.8,
                  13.3
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 58.3,
                "last1F": 13.8,
                "laps": [
                  14.8,
                  15,
                  14.7,
                  13.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 65.9,
                "last1F": 15.5,
                "laps": [
                  18,
                  16.4,
                  16,
                  15.5
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 50.8,
                "last1F": 13.7,
                "laps": [
                  13.1,
                  11.9,
                  12.1,
                  13.7
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-03",
                "course": "栗東坂路",
                "time4F": 66,
                "last1F": 15.3,
                "laps": [
                  18.3,
                  16.9,
                  15.5,
                  15.3
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 5,
            "damDam": "Sunday Valentine",
            "review": null
          }
        },
        {
          "id": "kokura11-07",
          "number": 7,
          "name": "デアヴェローチェ",
          "jockey": "川田将雅",
          "popularity": 2,
          "odds": 4.3,
          "aiScore": 84,
          "comment": "平均着差は最良。1200への短縮が唯一の論点",
          "analysis": {
            "tags": [
              "安定株",
              "距離短縮"
            ],
            "factors": {
              "ability": 89,
              "course": 76,
              "distance": 87,
              "pace": 68,
              "lap": 76,
              "training": 93,
              "trainingLap": 89,
              "stable": 68,
              "frame": 71
            },
            "insight": [
              "平均着差0.46秒は全馬で最良の安定感",
              "戦歴は1400〜1600中心。短縮対応が焦点",
              "2人気4.3倍でEV0.48。実力相応の売れ方"
            ],
            "pros": [
              "着差0.0秒の勝ち負け水準を経験済みで地力上位",
              "崩れの少なさはメンバー随一"
            ],
            "cons": [
              "芝1200は過去7走中2走でテンの速さは未知数",
              "期待値上の妙味は薄い"
            ],
            "commentary": "過去7走の平均着差0.46秒は出走馬で最も小さく、大崩れしない地力はここでも上位。ただ戦歴は1400〜1600mが中心で、下り坂スタートから前半3ハロンが速くなる小倉1200への短縮は、追走面が最大の論点になります。指数126は首位と1ポイント差の2位。序盤で流れに乗れれば勝ち負け、置かれると短い直線では届かず、の二択と分析します。",
            "frameEval": {
              "score": 71,
              "text": "13頭立ての7番枠。中枠は序盤の位置取り次第でどちらにも転ぶ並びで、テンのダッシュ力が問われます。"
            },
            "trainingEval": {
              "grade": "A",
              "oneWeek": {
                "score": 93,
                "text": "一週前は6/24に栗東CWで4F52.4-1F11.4(ラップ 15.1-14.2-11.7-11.4)。終いまで加速する好内容です"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F54.1-1F12.4(ラップ 14.8-14.0-12.9-12.4)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 10,
                "mid": 0,
                "note": "直近の登坂・追い切りは計10本(うち中間調整0本)。乗り込み量は豊富です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "マテラスカイ",
                  "note": "米国型のダート短距離血統。テンの速さが武器"
                },
                {
                  "role": "母",
                  "name": "ミニーアイル",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "ミッキーアイル",
                  "note": "スピードを補強"
                },
                {
                  "role": "母の母",
                  "name": "アイランドファッション",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 79,
                "distance": 88,
                "going": 86,
                "lap": 75,
                "family": 97,
                "speed": 97,
                "stamina": 87,
                "burst": 92,
                "sustain": 73
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 28,
                "note": "指数1位 × 2人気 → 単勝期待値0.56"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 87,
                "note": "一週前追い切り × 間隔5週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 81,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 51,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 5,
            "speedIndex": 126,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "179",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "115",
                "track": null,
                "distance": 1600,
                "surface": "芝",
                "margin": 0.6,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "7",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 0.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "7",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "15",
                "track": null,
                "distance": 1600,
                "surface": "芝",
                "margin": 0,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東CW",
                "time4F": 52.4,
                "last1F": 11.4,
                "laps": [
                  15.1,
                  14.2,
                  11.7,
                  11.4
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-26",
                "course": "栗東CW",
                "time4F": 221.4,
                "last1F": 50.8,
                "laps": [
                  57.8,
                  60.1,
                  52.7,
                  50.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東CW",
                "time4F": 117.6,
                "last1F": 26.6,
                "laps": [
                  32.5,
                  30.8,
                  27.7,
                  26.6
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東CW",
                "time4F": 241.8,
                "last1F": 56.3,
                "laps": [
                  62.9,
                  61.3,
                  61.3,
                  56.3
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": null,
                "course": "栗東CW",
                "time4F": 92.6,
                "last1F": 21.3,
                "laps": [
                  25.1,
                  23.9,
                  22.3,
                  21.3
                ],
                "phase": "不明",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東坂路",
                "time4F": 64.8,
                "last1F": 15.3,
                "laps": [
                  17.5,
                  16.5,
                  15.5,
                  15.3
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 55.9,
                "last1F": 13.2,
                "laps": [
                  15.8,
                  14,
                  12.9,
                  13.2
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 62.9,
                "last1F": 14.8,
                "laps": [
                  17.3,
                  16,
                  14.8,
                  14.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 54.1,
                "last1F": 12.4,
                "laps": [
                  14.8,
                  14,
                  12.9,
                  12.4
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-03",
                "course": "栗東坂路",
                "time4F": 66.9,
                "last1F": 15.6,
                "laps": [
                  19,
                  16.8,
                  15.5,
                  15.6
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 10,
            "damDam": "アイランドファッション",
            "review": null
          }
        },
        {
          "id": "kokura11-08",
          "number": 8,
          "name": "アメリカンビキニ",
          "jockey": "酒井学",
          "popularity": 6,
          "odds": 12.2,
          "aiScore": 78,
          "comment": "指数4位も38週ぶり。態勢面が全て",
          "analysis": {
            "tags": [
              "休み明け",
              "能力上位"
            ],
            "factors": {
              "ability": 83,
              "course": 67,
              "distance": 90,
              "pace": 72,
              "lap": 76,
              "training": 69,
              "trainingLap": 64,
              "stable": 67,
              "frame": 70
            },
            "insight": [
              "指数117は4位も38週の休み明けが最大の壁",
              "ダート4走を含む戦歴。芝1200は2走のみ",
              "EV1.13。走れる態勢なら妙味圏"
            ],
            "pros": [
              "能力値は上位グループに位置する",
              "休養前の前走は0.6秒差と内容自体は悪くない"
            ],
            "cons": [
              "38週ぶりで、登坂3本も終い15秒台と時計に上積みが見えない",
              "芝1200の経験が浅く適性評価に推定が混じる"
            ],
            "commentary": "指数117は4位と能力面では上位グループ。ただし出走間隔38週、約9カ月ぶりの実戦が最大の不確定要素。休養明けの登坂は3本にとどまり、終いも15秒台までと時計面の上積みはまだ見えません。ダート4走を含む戦歴で芝1200は2走のみと、適性面も推定が混じります。走れる態勢にあるなら6人気は過小評価の余地がありますが、信頼度を割り引いて扱うべき一頭です。",
            "frameEval": {
              "score": 70,
              "text": "13頭立ての8番枠。中枠は序盤の位置取り次第でどちらにも転ぶ並びで、テンのダッシュ力が問われます。"
            },
            "trainingEval": {
              "grade": "C",
              "oneWeek": {
                "score": 69,
                "text": "一週前は6/30に栗東坂路で4F67.8-1F15.7(ラップ 18.8-17.4-15.9-15.7)。軽めの調整です"
              },
              "final": {
                "status": "未取得",
                "text": "最終追い切りのデータは未取得です(評価は一週前を主要材料としています)。"
              },
              "stablePattern": {
                "match": false,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 3,
                "mid": 0,
                "note": "直近の登坂・追い切りは計3本(うち中間調整0本)。乗り込み量は標準です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "American Pharoah",
                  "note": "米三冠馬。スピードの絶対値が高い血統"
                },
                {
                  "role": "母",
                  "name": "パリスビキニ",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "Bernardini",
                  "note": "米国のパワーを補強"
                },
                {
                  "role": "母の母",
                  "name": "Lacadena",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 69,
                "distance": 93,
                "going": 84,
                "lap": 74,
                "family": 97,
                "speed": 83,
                "stamina": 91,
                "burst": 85,
                "sustain": 79
              }
            },
            "confidence": "mid",
            "confidenceReasons": [
              "出走間隔38週の長期休養明けで状態評価に振れ幅がある",
              "調教時計は確認済みだが休養明けの実戦感は未知数",
              "能力はスピード指数で裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 47,
                "note": "指数6位 × 6人気 → 単勝期待値0.94"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 65,
                "note": "一週前追い切り × 間隔38週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 76,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 55,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 38,
            "speedIndex": 117,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "ダ",
                "margin": 0.6,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "ダ",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "131",
                "track": null,
                "distance": 1400,
                "surface": "ダ",
                "margin": 0.6,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "115",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "115",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "195",
                "track": null,
                "distance": 1700,
                "surface": "ダ",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-26",
                "course": "栗東坂路",
                "time4F": 68,
                "last1F": 16.9,
                "laps": [
                  17.3,
                  16.9,
                  16.9,
                  16.9
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東坂路",
                "time4F": 69.3,
                "last1F": 16.4,
                "laps": [
                  19,
                  17.3,
                  16.6,
                  16.4
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 67.8,
                "last1F": 15.7,
                "laps": [
                  18.8,
                  17.4,
                  15.9,
                  15.7
                ],
                "phase": "一週前",
                "eval": null
              }
            ],
            "trainingCount": 3,
            "damDam": "Lacadena",
            "review": null
          }
        },
        {
          "id": "kokura11-09",
          "number": 9,
          "name": "ヨシノイースター",
          "jockey": "田辺裕信",
          "popularity": 4,
          "odds": 7.9,
          "aiScore": 79,
          "comment": "条件経験は豊富。決め手で上位に見劣り",
          "analysis": {
            "tags": [
              "小倉経験",
              "堅実"
            ],
            "factors": {
              "ability": 77,
              "course": 78,
              "distance": 90,
              "pace": 69,
              "lap": 75,
              "training": 82,
              "trainingLap": 83,
              "stable": 69,
              "frame": 66
            },
            "insight": [
              "小倉2走・芝1200を5走と条件経験が豊富",
              "平均0.67秒差で堅実も勝ち切りは薄い",
              "4人気7.9倍でEV0.67。妙味は無い"
            ],
            "pros": [
              "小倉を含む条件経験の多さは計算材料になる",
              "大敗が少なく馬券の組み立てがしやすい"
            ],
            "cons": [
              "指数112は上位3頭と明確な差がある",
              "前走0.9秒差で上積みの根拠が薄い"
            ],
            "commentary": "小倉2走・芝1200を5走とこの条件の経験値はメンバー上位で、平均0.67秒差の堅実さも武器です。ただ指数112は上位グループと差があり、直線約293mの小倉では前を捕まえ切る決め手の差がそのまま着順に出やすい。4人気の支持は経験値込みで妥当な範囲ですが、期待値0.67と価格の妙味はなく、評価は相手候補までと分析します。",
            "frameEval": {
              "score": 66,
              "text": "13頭立ての9番枠。中枠は序盤の位置取り次第でどちらにも転ぶ並びで、テンのダッシュ力が問われます。"
            },
            "trainingEval": {
              "grade": "B",
              "oneWeek": {
                "score": 82,
                "text": "一週前は6/24に栗東坂路で4F52.4-1F12.1(ラップ 14.9-13.4-12.0-12.1)。まずまずの動きです"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F53.7-1F12.1(ラップ 14.7-13.9-13.0-12.1)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 7,
                "mid": 0,
                "note": "直近の登坂・追い切りは計7本(うち中間調整0本)。乗り込み量は豊富です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "ルーラーシップ",
                  "note": "キングカメハメハ系のスタミナ・底力型"
                },
                {
                  "role": "母",
                  "name": "アースブレイ",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "ゼンノロブロイ",
                  "note": "堅実さと底力を補強"
                },
                {
                  "role": "母の母",
                  "name": "ミスイースター",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 78,
                "distance": 91,
                "going": 86,
                "lap": 78,
                "family": 97,
                "speed": 72,
                "stamina": 94,
                "burst": 77,
                "sustain": 80
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 33,
                "note": "指数5位 × 4人気 → 単勝期待値0.67"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 81,
                "note": "一週前追い切り × 間隔5週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 81,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 58,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 5,
            "speedIndex": 112,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "115",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "195",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "179",
                "track": null,
                "distance": 1400,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "195",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "179",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 52.4,
                "last1F": 12.1,
                "laps": [
                  14.9,
                  13.4,
                  12,
                  12.1
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-26",
                "course": "栗東坂路",
                "time4F": 70,
                "last1F": 19.5,
                "laps": [
                  17.1,
                  16,
                  17.4,
                  19.5
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 64.6,
                "last1F": 16.3,
                "laps": [
                  16.2,
                  15.8,
                  16.3,
                  16.3
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 60.2,
                "last1F": 15.1,
                "laps": [
                  16,
                  14.8,
                  14.3,
                  15.1
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 62.1,
                "last1F": 15.8,
                "laps": [
                  16.3,
                  14.9,
                  15.1,
                  15.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 53.7,
                "last1F": 12.1,
                "laps": [
                  14.7,
                  13.9,
                  13,
                  12.1
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-03",
                "course": "栗東坂路",
                "time4F": 62.8,
                "last1F": 15.7,
                "laps": [
                  16.5,
                  15,
                  15.6,
                  15.7
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 7,
            "damDam": "ミスイースター",
            "review": null
          }
        },
        {
          "id": "kokura11-10",
          "number": 10,
          "name": "サウンドモリアーナ",
          "jockey": "吉村誠之助",
          "popularity": 7,
          "odds": 12.7,
          "aiScore": 81,
          "comment": "指数3位で7人気。今週の期待値の中心",
          "analysis": {
            "tags": [
              "スプリント特化",
              "妙味"
            ],
            "factors": {
              "ability": 86,
              "course": 69,
              "distance": 90,
              "pace": 72,
              "lap": 78,
              "training": 82,
              "trainingLap": 76,
              "stable": 67,
              "frame": 64
            },
            "insight": [
              "指数119で3位評価に対し7人気の乖離",
              "戦歴は1000〜1200mのみの生粋の短距離型",
              "EV1.29はメンバー上位。妙味の中心"
            ],
            "pros": [
              "短距離専業の戦歴でテンの速い流れへの適性が高い",
              "指数3位と市場評価(7人気)のギャップが大きい"
            ],
            "cons": [
              "小倉コースは過去7走で未経験",
              "10週ぶりの実戦自体は割引が必要"
            ],
            "commentary": "戦歴は1000〜1200mのみという生粋のスプリンターで、テンが速くなる小倉1200の質は合うタイプ。前走0.4秒差・平均0.63秒差と内容も安定しており、指数119の3位評価に対して7人気・単勝12.7倍は市場の見落としと分析します。期待値1.29は今回の中心的な妙味。不確定要素は小倉未経験のみ。10週の間隔も坂路6本、直前は4F55.4-1F12.5と順調に乗り込まれています。",
            "frameEval": {
              "score": 64,
              "text": "13頭立ての10番枠。外めは下り坂スタートで被されにくい反面、道中の距離ロスが出やすい並びです。"
            },
            "trainingEval": {
              "grade": "B",
              "oneWeek": {
                "score": 82,
                "text": "一週前は6/27に栗東坂路で4F53.8-1F12.5(ラップ 15.9-13.3-12.1-12.5)。まずまずの動きです"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F55.4-1F12.5(ラップ 15.0-15.0-12.9-12.5)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 6,
                "mid": 0,
                "note": "直近の登坂・追い切りは計6本(うち中間調整0本)。乗り込み量は豊富です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "ミッキーアイル",
                  "note": "快速マイラー。産駒も短距離向きの速さが持ち味"
                },
                {
                  "role": "母",
                  "name": "サウンドリアーナ",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "ケイムホーム",
                  "note": "短距離向きの機動力を補強"
                },
                {
                  "role": "母の母",
                  "name": "オテンバコマチ",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 72,
                "distance": 91,
                "going": 86,
                "lap": 77,
                "family": 97,
                "speed": 96,
                "stamina": 90,
                "burst": 89,
                "sustain": 75
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 64,
                "note": "指数3位 × 7人気 → 単勝期待値1.28"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 81,
                "note": "一週前追い切り × 間隔10週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 78,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 55,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 10,
            "speedIndex": 119,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1000,
                "surface": "ダ",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1000,
                "surface": "ダ",
                "margin": 0.2,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 57.4,
                "last1F": 12.3,
                "laps": [
                  16.9,
                  15.2,
                  13,
                  12.3
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-26",
                "course": "栗東坂路",
                "time4F": 64.9,
                "last1F": 15.7,
                "laps": [
                  17,
                  16.4,
                  15.8,
                  15.7
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東坂路",
                "time4F": 53.8,
                "last1F": 12.5,
                "laps": [
                  15.9,
                  13.3,
                  12.1,
                  12.5
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 63,
                "last1F": 15.2,
                "laps": [
                  16.5,
                  15.7,
                  15.6,
                  15.2
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 55.4,
                "last1F": 12.5,
                "laps": [
                  15,
                  15,
                  12.9,
                  12.5
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-03",
                "course": "栗東坂路",
                "time4F": 65.4,
                "last1F": 15.8,
                "laps": [
                  17.3,
                  15.7,
                  16.6,
                  15.8
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 6,
            "damDam": "オテンバコマチ",
            "review": null
          }
        },
        {
          "id": "kokura11-11",
          "number": 11,
          "name": "ヤマニンアルリフラ",
          "jockey": "団野大成",
          "popularity": 5,
          "odds": 11.9,
          "aiScore": 77,
          "comment": "小倉5走の巧者。前走0.2秒差から間隔明け",
          "analysis": {
            "tags": [
              "小倉巧者",
              "直近好調"
            ],
            "factors": {
              "ability": 68,
              "course": 84,
              "distance": 90,
              "pace": 71,
              "lap": 79,
              "training": 85,
              "trainingLap": 76,
              "stable": 66,
              "frame": 68
            },
            "insight": [
              "小倉5走はメンバー最多クラスの経験",
              "前走0.2秒差と直近の内容は良い",
              "5人気11.9倍でEV0.84。実力相応の評価"
            ],
            "pros": [
              "小倉のコース経験の厚さは明確な強み",
              "前走0.2秒差で状態面の下地を示した"
            ],
            "cons": [
              "12週の間隔でその好調が続くかは未確認",
              "指数106は上位勢と差があり展開の助けが要る"
            ],
            "commentary": "過去7走中5走を小倉で走ったコース巧者で、下りから速くなる流れへの対応は実績で示しています。前走0.2秒差と直近内容も良く、噛み合えば上位争いまで。ただ12週の間隔でその好調が持続しているかの確認材料が無く、指数106は上位勢と差があります。5人気・期待値0.84は、実力を過不足なく映した価格と分析します。",
            "frameEval": {
              "score": 68,
              "text": "13頭立ての11番枠。外めは下り坂スタートで被されにくい反面、道中の距離ロスが出やすい並びです。"
            },
            "trainingEval": {
              "grade": "A",
              "oneWeek": {
                "score": 85,
                "text": "一週前は6/24に栗東坂路で4F53.3-1F12.1(ラップ 15.7-13.1-12.4-12.1)。終いまで加速する好内容です"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F56.1-1F12.0(ラップ 15.8-14.9-13.4-12.0)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 13,
                "mid": 0,
                "note": "直近の登坂・追い切りは計13本(うち中間調整0本)。乗り込み量は豊富です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "イスラボニータ",
                  "note": "フジキセキ系の堅実なマイル〜中距離型"
                },
                {
                  "role": "母",
                  "name": "ヤマニンパピオネ",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "スウェプトオーヴァーボード",
                  "note": "米国型のスピードを補強"
                },
                {
                  "role": "母の母",
                  "name": "ヤマニンメルティ",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 82,
                "distance": 89,
                "going": 79,
                "lap": 80,
                "family": 97,
                "speed": 74,
                "stamina": 87,
                "burst": 66,
                "sustain": 78
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 42,
                "note": "指数7位 × 5人気 → 単勝期待値0.84"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 83,
                "note": "一週前追い切り × 間隔12週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 83,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 57.5,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 12,
            "speedIndex": 106,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "ダ",
                "margin": 0.2,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "195",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.8,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "195",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.5,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 83,
                "last1F": 19.4,
                "laps": [
                  21.9,
                  21.7,
                  20,
                  19.4
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 53.3,
                "last1F": 12.1,
                "laps": [
                  15.7,
                  13.1,
                  12.4,
                  12.1
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-26",
                "course": "栗東坂路",
                "time4F": 86.2,
                "last1F": 21.2,
                "laps": [
                  22.8,
                  21.5,
                  20.7,
                  21.2
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-26",
                "course": "栗東坂路",
                "time4F": 70.5,
                "last1F": 16.8,
                "laps": [
                  19.2,
                  17.3,
                  17.2,
                  16.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-27",
                "course": "栗東坂路",
                "time4F": 68.3,
                "last1F": 16.1,
                "laps": [
                  18.8,
                  16.9,
                  16.5,
                  16.1
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 80.2,
                "last1F": 18.9,
                "laps": [
                  21.9,
                  20.1,
                  19.3,
                  18.9
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 57.6,
                "last1F": 12.5,
                "laps": [
                  16.8,
                  14.4,
                  13.9,
                  12.5
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 76.2,
                "last1F": 17.6,
                "laps": [
                  20.8,
                  19.6,
                  18.2,
                  17.6
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-30",
                "course": "栗東坂路",
                "time4F": 69.2,
                "last1F": 16.5,
                "laps": [
                  18.5,
                  17.4,
                  16.8,
                  16.5
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 82.6,
                "last1F": 19.9,
                "laps": [
                  21.6,
                  20.9,
                  20.2,
                  19.9
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 56.1,
                "last1F": 12,
                "laps": [
                  15.8,
                  14.9,
                  13.4,
                  12
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-03",
                "course": "栗東坂路",
                "time4F": 83.8,
                "last1F": 19.2,
                "laps": [
                  23.1,
                  21.3,
                  20.2,
                  19.2
                ],
                "phase": "最終",
                "eval": null
              },
              {
                "date": "2026-07-03",
                "course": "栗東坂路",
                "time4F": 71,
                "last1F": 16.3,
                "laps": [
                  19.6,
                  17.9,
                  17.2,
                  16.3
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 13,
            "damDam": "ヤマニンメルティ",
            "review": null
          }
        },
        {
          "id": "kokura11-12",
          "number": 12,
          "name": "フリッカージャブ",
          "jockey": "松山弘平",
          "popularity": 1,
          "odds": 3.7,
          "aiScore": 84,
          "comment": "指数首位。1200戦線の主軸も安定感は普通",
          "analysis": {
            "tags": [
              "指数首位",
              "1200実績",
              "軸候補"
            ],
            "factors": {
              "ability": 92,
              "course": 72,
              "distance": 90,
              "pace": 69,
              "lap": 73,
              "training": 90,
              "trainingLap": 83,
              "stable": 69,
              "frame": 66
            },
            "insight": [
              "指数127はメンバー単独トップの評価",
              "芝1200を6走使われた王道ローテ",
              "1人気3.7倍でEV0.45。過剰人気気味"
            ],
            "pros": [
              "メンバー最上位の指数で能力の裏付けが最も厚い",
              "一週前は坂路4F51.3-1F11.9と態勢も整っている"
            ],
            "cons": [
              "近走は1秒級の敗戦も混じり盤石ではない",
              "単勝3.7倍は指数の優位幅に対してやや過剰"
            ],
            "commentary": "小倉芝1200はスタート後に下る形状でテンが速く、直線約293mの前有利コース。指数127は当メンバーの単独トップで、芝1200を6走続けた実績も適性を裏付けます。一方で近走の着差には1.1秒差の敗戦も混じり、信頼度は「最上位だが盤石ではない」水準。単勝3.7倍まで売れた現在は期待値0.45で、評価と価格の釣り合いだけ割り引いて見ます。",
            "frameEval": {
              "score": 66,
              "text": "13頭立ての12番枠。外めは下り坂スタートで被されにくい反面、道中の距離ロスが出やすい並びです。"
            },
            "trainingEval": {
              "grade": "A",
              "oneWeek": {
                "score": 90,
                "text": "一週前は6/24に栗東坂路で4F51.3-1F11.9(ラップ 13.5-13.5-12.4-11.9)。終いまで加速する好内容です"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F53.1-1F11.9(ラップ 14.9-14.0-12.3-11.9)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 3,
                "mid": 0,
                "note": "直近の登坂・追い切りは計3本(うち中間調整0本)。乗り込み量は標準です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "サトゥルナーリア",
                  "note": "自身は芝中距離GI馬。産駒は初期世代"
                },
                {
                  "role": "母",
                  "name": "ナイキトルナード",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "サクラバクシンオー",
                  "note": "短距離適性を強く補強するスプリント名母父"
                },
                {
                  "role": "母の母",
                  "name": "ナイキフェイバー",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 71,
                "distance": 90,
                "going": 92,
                "lap": 75,
                "family": 97,
                "speed": 92,
                "stamina": 88,
                "burst": 91,
                "sustain": 73
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 24,
                "note": "指数2位 × 1人気 → 単勝期待値0.48"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 85,
                "note": "一週前追い切り × 間隔7週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 79,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 57.5,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 7,
            "speedIndex": 127,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "163",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.9,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.2,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.1,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "23",
                "track": null,
                "distance": 1400,
                "surface": "ダ",
                "margin": 0.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-24",
                "course": "栗東坂路",
                "time4F": 51.3,
                "last1F": 11.9,
                "laps": [
                  13.5,
                  13.5,
                  12.4,
                  11.9
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 55.8,
                "last1F": 12.7,
                "laps": [
                  15.8,
                  14.6,
                  12.7,
                  12.7
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 53.1,
                "last1F": 11.9,
                "laps": [
                  14.9,
                  14,
                  12.3,
                  11.9
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 3,
            "damDam": "ナイキフェイバー",
            "review": null
          }
        },
        {
          "id": "kokura11-13",
          "number": 13,
          "name": "イツモニコニコ",
          "jockey": "藤懸貴志",
          "popularity": 12,
          "odds": 40,
          "aiScore": 73,
          "comment": "前走0.3秒差。40倍は前走を織り込まず",
          "analysis": {
            "tags": [
              "1200専業",
              "一発妙味"
            ],
            "factors": {
              "ability": 62,
              "course": 70,
              "distance": 90,
              "pace": 68,
              "lap": 78,
              "training": 80,
              "trainingLap": 83,
              "stable": 68,
              "frame": 65
            },
            "insight": [
              "芝1200を7走の生粋のスプリンター",
              "前走0.3秒差と直近は圏内が見える内容",
              "12人気40倍でEV1.91。一発枠の筆頭"
            ],
            "pros": [
              "前走0.3秒差で通用の可能性を示した",
              "40倍まで売られ期待値は全馬トップ級"
            ],
            "cons": [
              "平均0.94秒差とムラが大きい",
              "指数91で能力面の裏付けは弱い"
            ],
            "commentary": "芝1200を7走の専業スプリンターで、前走は0.3秒差と馬券圏内が見える内容でした。平均着差0.94秒というムラの大きさが人気を落とす理由ですが、12人気・単勝40倍はその前走の内容を織り込んでいない価格で、期待値1.91は数字上メンバー最上位級。軸には不向きでも、噛み合った時だけ走る一発枠として押さえる価値があると分析します。",
            "frameEval": {
              "score": 65,
              "text": "13頭立ての13番枠。外めは下り坂スタートで被されにくい反面、道中の距離ロスが出やすい並びです。"
            },
            "trainingEval": {
              "grade": "B",
              "oneWeek": {
                "score": 80,
                "text": "一週前は6/25に栗東坂路で4F52.1-1F12.1(ラップ 14.8-13.2-12.0-12.1)。まずまずの動きです"
              },
              "final": {
                "status": "確認済み",
                "text": "最終は7/1に栗東坂路で4F52.7-1F11.9(ラップ 15.2-13.3-12.3-11.9)。終いまで加速する好内容です"
              },
              "stablePattern": {
                "match": true,
                "text": "厩舎の勝負調教パターン照合は未接続のため、調教評価からの仮判定です。"
              },
              "volume": {
                "total": 3,
                "mid": 0,
                "note": "直近の登坂・追い切りは計3本(うち中間調整0本)。乗り込み量は標準です。"
              }
            },
            "pedigree": {
              "lines": [
                {
                  "role": "父",
                  "name": "ビッグアーサー",
                  "note": "高松宮記念勝ち馬。生粋のスプリンター血統"
                },
                {
                  "role": "母",
                  "name": "オルトリンデ",
                  "note": "血統表より取得"
                },
                {
                  "role": "母父",
                  "name": "ダンスインザダーク",
                  "note": "スタミナを補強"
                },
                {
                  "role": "母の母",
                  "name": "オスティエンセ",
                  "note": "血統表より取得"
                }
              ],
              "scores": {
                "course": 68,
                "distance": 93,
                "going": 76,
                "lap": 79,
                "family": 97,
                "speed": 71,
                "stamina": 88,
                "burst": 60,
                "sustain": 77
              }
            },
            "confidence": "high",
            "confidenceReasons": [
              "近走データが3走分以上揃っている",
              "一週前追い切りの時計を確認済み",
              "スピード指数による能力の裏付けあり"
            ],
            "crossAnalysis": {
              "indexXvalue": {
                "status": "ok",
                "score": 97,
                "note": "指数12位 × 12人気 → 単勝期待値1.94"
              },
              "styleXpace": {
                "status": "未取得",
                "note": "脚質データ(supplement の脚質列 または TARGET出力)の接続後に自動算出されます"
              },
              "trainingXfreshness": {
                "status": "ok",
                "score": 80,
                "note": "一週前追い切り × 間隔7週"
              },
              "pedigreeXcourse": {
                "status": "ok",
                "score": 75,
                "note": "血統 × コース適性"
              },
              "goingXpedigree": {
                "status": "未取得",
                "note": "馬場状態履歴 × 血統データの接続後に自動算出されます"
              }
            }
          },
          "raw": {
            "weight": 53,
            "horseWeight": null,
            "weightDiff": null,
            "intervalWeeks": 7,
            "speedIndex": 91,
            "runningStyle": null,
            "pastRuns": [
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "131",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 1.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "67",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.7,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 2.8,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.3,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              },
              {
                "courseCode": "43",
                "track": null,
                "distance": 1200,
                "surface": "芝",
                "margin": 0.4,
                "finish": null,
                "passing": null,
                "agari": null,
                "class": null,
                "going": null,
                "date": null,
                "index": null
              }
            ],
            "trainingSessions": [
              {
                "date": "2026-06-25",
                "course": "栗東坂路",
                "time4F": 52.1,
                "last1F": 12.1,
                "laps": [
                  14.8,
                  13.2,
                  12,
                  12.1
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-06-28",
                "course": "栗東坂路",
                "time4F": 57.1,
                "last1F": 13.8,
                "laps": [
                  15.8,
                  13.8,
                  13.7,
                  13.8
                ],
                "phase": "一週前",
                "eval": null
              },
              {
                "date": "2026-07-01",
                "course": "栗東坂路",
                "time4F": 52.7,
                "last1F": 11.9,
                "laps": [
                  15.2,
                  13.3,
                  12.3,
                  11.9
                ],
                "phase": "最終",
                "eval": null
              }
            ],
            "trainingCount": 3,
            "damDam": "オスティエンセ",
            "review": null
          }
        }
      ]
    }
  ],
  "featured": [
    {
      "horseId": "kokura11-07",
      "raceId": "kokura-11",
      "note": "調教込みのTM INDEXで最上位。平均着差0.46秒の安定株が直前CWで4F52.4-1F11.4と仕上がりも文句なし"
    },
    {
      "horseId": "kokura11-12",
      "raceId": "kokura-11",
      "note": "TARGET指数127は単独トップ。一週前坂路4F51.3-1F11.9と態勢も整い、死角は3.7倍という価格だけ"
    },
    {
      "horseId": "kokura11-10",
      "raceId": "kokura-11",
      "note": "指数3位に対して7人気の見落とし枠。坂路6本の順調な仕上げで、小倉の速い流れ向きの短距離専業。EV1.28"
    }
  ]
};
/* ===== WEEK_DATA:END ===== */

/* =====================================================================
 * [2] lib/logic — 分析ロジック(全て純関数・データから自動計算)
 * ---------------------------------------------------------------------
 * 分析ポリシー: 人気順の後追いはしない。
 * 期待値 = 推定勝率 × 単勝オッズ をAI指数から独立に算出し、
 * 混戦(指数が拮抗)時ほど中位指数×高オッズの馬が浮上する設計。
 * ===================================================================== */

/** AI指数からレース内の推定勝率を算出(指数のべき乗シェア) */
const winProbability = (horse, field, k = 7) => {
  const w = (h) => Math.pow(h.aiScore / 100, k);
  const total = field.reduce((s, h) => s + w(h), 0);
  return w(horse) / total;
};

/** 期待値評価: { prob, ev, verdict } */
const evaluateValue = (horse, field) => {
  const prob = winProbability(horse, field);
  const ev = prob * horse.odds;
  const verdict =
    ev >= 1.15 ? { label: "妙味あり", tone: "blue" }
    : ev >= 0.95 ? { label: "中立", tone: "gray" }
    : { label: "過剰人気気味", tone: "gray" };
  return { prob, ev, verdict };
};

/** 血統指数 = 9項目の平均 */
const pedigreeIndex = (pedigree) => {
  const v = Object.values(pedigree.scores);
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
};

/** レース内Rank(AI指数順) { horseId: rank } */
const rankByScore = (horses) =>
  Object.fromEntries(
    [...horses].sort((a, b) => b.aiScore - a.aiScore).map((h, i) => [h.id, i + 1])
  );

/** レース単位の分析信頼度(全馬の信頼度の加重平均) */
const raceConfidence = (horses) => {
  const weight = { high: 3, mid: 2, low: 1 };
  const avg = horses.reduce((s, h) => s + weight[h.analysis.confidence], 0) / horses.length;
  return avg >= 2.5 ? "high" : avg >= 1.8 ? "mid" : "low";
};

/** TM INDEX ティア */
const scoreTier = (v) =>
  v >= 90 ? { label: "S", text: "TOP評価" }
  : v >= 80 ? { label: "A", text: "有力評価" }
  : v >= 70 ? { label: "B", text: "標準評価" }
  : v >= 60 ? { label: "C", text: "割引評価" }
  : { label: "D", text: "厳しい評価" };

/** TM VALUE: 期待値の5段階(1.00が損益分岐) */
const valueStars = (ev) =>
  ev >= 1.3 ? 5 : ev >= 1.15 ? 4 : ev >= 1.0 ? 3 : ev >= 0.85 ? 2 : 1;

/** 分析信頼度の5段階(レベル + 調教評価の裏付けで加点) */
const confidenceStars = (a) => {
  const base = { high: 4, mid: 3, low: 2 }[a.confidence];
  return Math.min(5, base + (a.trainingEval?.grade === "A" ? 1 : 0));
};

/** AI指数の内訳(ファクター×重みの寄与。合計との差は「総合補正」として明示) */
const BREAKDOWN_DEFS = [
  { label: "能力", calc: (f) => f.ability * 0.3 },
  { label: "コース適性", calc: (f) => f.course * 0.08 },
  { label: "距離適性", calc: (f) => f.distance * 0.12 },
  { label: "展開", calc: (f) => f.pace * 0.1 },
  { label: "ラップ", calc: (f) => f.lap * 0.08 },
  { label: "調教", calc: (f) => f.training * 0.12 + f.trainingLap * 0.05 },
  { label: "血統", calc: (_f, ped) => ped * 0.1 },
  { label: "厩舎・枠順", calc: (f) => f.stable * 0.03 + f.frame * 0.02 },
];
const scoreBreakdown = (horse) => {
  const f = horse.analysis.factors;
  const ped = pedigreeIndex(horse.analysis.pedigree);
  const items = BREAKDOWN_DEFS.map((d) => ({ label: d.label, value: Math.round(d.calc(f, ped)) }));
  const adjust = horse.aiScore - items.reduce((s, i) => s + i.value, 0);
  return { items, adjust };
};

/** 週次データの検証(差し替えミスの検出。エラーはconsoleとUIバナーに出る) */
const FACTOR_KEYS = ["ability", "distance", "lap", "training", "trainingLap", "stable", "frame", "course", "pace"];
const validateWeekData = (db) => {
  const errors = [];
  if (!db?.meta?.date) errors.push("meta.date がありません");
  for (const r of db?.races ?? []) {
    for (const k of ["id", "track", "number", "time", "surface", "distance", "going"])
      if (r[k] == null) errors.push(`${r.id || "?"}: ${k} が欠落`);
    if ((r.horses?.length ?? 0) !== r.fieldSize)
      errors.push(`${r.id}: fieldSize(${r.fieldSize}) と horses数(${r.horses?.length ?? 0}) が不一致`);
    for (const h of r.horses ?? []) {
      const a = h.analysis;
      if (!a) { errors.push(`${h.id}: analysis が欠落`); continue; }
      for (const k of FACTOR_KEYS) if (a.factors?.[k] == null) errors.push(`${h.id}: factors.${k} が欠落`);
      if (!a.insight?.length) errors.push(`${h.id}: insight が空`);
      if (!a.confidenceReasons?.length) errors.push(`${h.id}: confidenceReasons が空(信頼度には理由が必須)`);
      if (!a.pedigree?.lines?.length || !a.pedigree?.scores) errors.push(`${h.id}: pedigree が欠落`);
    }
  }
  return errors;
};
const DATA_ERRORS = validateWeekData(WEEK_DATA);
if (DATA_ERRORS.length) console.warn("[TURF MATRIX] week-data 検証警告:", DATA_ERRORS);

/* =====================================================================
 * [3] lib/dataProvider — データ取得層
 * ---------------------------------------------------------------------
 * UIはこの層の関数のみを呼ぶ。全関数async。
 * Data Lab / API / DB へ差し替える場合はこのブロックの中身だけを置換する。
 *   例: getRace(id) → fetch(`/api/races/${id}`).then(r => r.json())
 * ===================================================================== */
const simulateLatency = (data, ms = 120) =>
  new Promise((resolve) => setTimeout(() => resolve(data), ms));

const dataProvider = {
  async getMeta() {
    // 集計値はデータから自動算出(毎週の手入力を無くす)
    const raceCount = WEEK_DATA.races.length;
    const horseCount = WEEK_DATA.races.reduce((s, r) => s + r.horses.length, 0);
    return simulateLatency({ ...WEEK_DATA.meta, raceCount, horseCount }, 60);
  },
  async getDailySummary() {
    return simulateLatency(WEEK_DATA.dailySummary);
  },
  async getRaces() {
    const list = WEEK_DATA.races.map((r) => {
      const top = [...r.horses].sort((a, b) => b.aiScore - a.aiScore)[0];
      return {
        ...r,
        horses: undefined,
        topHorse: { name: top.name, aiScore: top.aiScore },
        confidence: raceConfidence(r.horses),
      };
    });
    return simulateLatency(list);
  },
  async getRace(raceId) {
    const race = WEEK_DATA.races.find((r) => r.id === raceId) || null;
    return simulateLatency(race);
  },
  async getFeaturedHorses() {
    const items = WEEK_DATA.featured.map((f) => {
      const race = WEEK_DATA.races.find((r) => r.id === f.raceId);
      const horse = race.horses.find((h) => h.id === f.horseId);
      return {
        ...f,
        horse,
        raceLabel: `${race.track}${race.number}R`,
        ev: evaluateValue(horse, race.horses).ev,
      };
    });
    return simulateLatency(items);
  },
  async getIndexRanking(limit = 5) {
    const all = WEEK_DATA.races.flatMap((r) =>
      r.horses.map((h) => ({ horse: h, raceId: r.id, raceLabel: `${r.track}${r.number}R` }))
    );
    all.sort((a, b) => b.horse.aiScore - a.horse.aiScore);
    return simulateLatency(all.slice(0, limit));
  },
};

/* =====================================================================
 * [4] lib/format — 表示定義・ユーティリティ
 * ===================================================================== */
const FACTOR_DEFS = [
  { key: "ability", label: "能力", icon: Zap },
  { key: "course", label: "コース適性", icon: Map },
  { key: "distance", label: "距離適性", icon: Ruler },
  { key: "pace", label: "展開", icon: Route },
  { key: "lap", label: "ラップ適性", icon: Activity },
  { key: "pedigree", label: "血統", icon: Dna, derived: true },
  { key: "training", label: "調教", icon: Dumbbell },
  { key: "trainingLap", label: "調教ラップ", icon: Timer },
  { key: "stable", label: "厩舎パターン", icon: Home },
  { key: "frame", label: "枠順", icon: LayoutGrid },
];

/* ファクター比較テーブルの行(「どの馬がどこで優れているか」を3秒で) */
const COMPARE_DEFS = [
  { key: "ability", label: "能力" },
  { key: "course", label: "コース適性" },
  { key: "distance", label: "距離適性" },
  { key: "pace", label: "展開" },
  { key: "ev", label: "期待値", type: "ev" },
  { key: "training", label: "調教" },
  { key: "pedigree", label: "血統", type: "pedigree" },
];

const PEDIGREE_SCORE_DEFS = [
  { key: "course", label: "コース" },
  { key: "distance", label: "距離" },
  { key: "going", label: "馬場" },
  { key: "lap", label: "ラップ" },
  { key: "family", label: "近親実績" },
  { key: "speed", label: "スピード" },
  { key: "stamina", label: "スタミナ" },
  { key: "burst", label: "瞬発力" },
  { key: "sustain", label: "持続力" },
];

const CONFIDENCE = {
  high: { label: "High", dots: 3, note: "データ量・再現性とも十分" },
  mid: { label: "Mid", dots: 2, note: "一部ファクターの根拠が限定的" },
  low: { label: "Low", dots: 1, note: "サンプル不足のため振れ幅が大きい" },
};

const SORT_OPTIONS = [
  { key: "score", label: "AI指数" },
  { key: "ev", label: "期待値" },
  { key: "number", label: "馬番" },
  { key: "popularity", label: "人気" },
];

/* TM FACTORS v1: 将来の analysis.factors[key] との対応表(UIモック) */
const TM_FACTOR_MOCKS = [
  {
    key: "blood",
    label: "Blood",
    score: 82,
    maxScore: 100,
    stars: 4,
    summary: "血統背景と距離適性の噛み合い",
    evidence: "pedigree.lines / pedigree.scores を接続予定",
    status: "mock",
  },
  {
    key: "training",
    label: "Training",
    score: 91,
    maxScore: 100,
    stars: 5,
    summary: "追い切り内容と上昇度の強さ",
    evidence: "trainingEval / factors.training を接続予定",
    status: "mock",
  },
  {
    key: "course",
    label: "Course",
    score: 78,
    maxScore: 100,
    stars: 4,
    summary: "コース形態と過去傾向への適合",
    evidence: "factors.course / 距離条件を接続予定",
    status: "mock",
  },
  {
    key: "pace",
    label: "Pace",
    score: 68,
    maxScore: 100,
    stars: 3,
    summary: "想定ラップと脚質の相性",
    evidence: "factors.pace / factors.lap を接続予定",
    status: "mock",
  },
  {
    key: "stable",
    label: "Stable",
    score: 74,
    maxScore: 100,
    stars: 4,
    summary: "厩舎パターンと仕上げ精度",
    evidence: "factors.stable / stablePattern を接続予定",
    status: "mock",
  },
  {
    key: "form",
    label: "Form",
    score: 80,
    maxScore: 100,
    stars: 4,
    summary: "近走内容と状態面の安定感",
    evidence: "analysis.tags / comment / confidenceReasons を接続予定",
    status: "mock",
  },
  {
    key: "value",
    label: "Value",
    score: 88,
    maxScore: 100,
    stars: 5,
    summary: "市場評価とのギャップ",
    evidence: "evaluateValue のEV結果を接続予定",
    status: "mock",
  },
];

const sortHorses = (horses, sortKey, evMap) => {
  const arr = [...horses];
  if (sortKey === "score") arr.sort((a, b) => b.aiScore - a.aiScore);
  if (sortKey === "ev") arr.sort((a, b) => (evMap[b.id]?.ev ?? 0) - (evMap[a.id]?.ev ?? 0));
  if (sortKey === "number") arr.sort((a, b) => a.number - b.number);
  if (sortKey === "popularity") arr.sort((a, b) => a.popularity - b.popularity);
  return arr;
};

const scoreTone = (v) => (v >= 85 ? "text-emerald-600" : v >= 70 ? "text-slate-900" : "text-gray-500");
const evTone = (ev) => (ev >= 1.15 ? "text-teal-600" : ev >= 0.95 ? "text-slate-900" : "text-gray-500");

const commandFactors = (horse, ev) => {
  const factors = horse.analysis.factors;
  const valueScore = ev ? Math.max(35, Math.min(96, Math.round(ev.ev * 72))) : 50;
  return [
    { key: "blood", label: "Blood AI", value: pedigreeIndex(horse.analysis.pedigree) },
    { key: "training", label: "Training AI", value: factors.training },
    { key: "course", label: "Course AI", value: Math.round((factors.course + factors.distance) / 2) },
    { key: "pace", label: "Pace AI", value: factors.pace },
    { key: "stable", label: "Stable AI", value: factors.stable },
    { key: "form", label: "Form AI", value: Math.round((factors.ability + factors.lap) / 2) },
    { key: "value", label: "Value AI", value: valueScore },
  ];
};

/* カスタムフック: PC(≥768px)判定 — シート/インライン展開の切替に使用 */
const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
};

/* =====================================================================
 * [5] components — UI部品
 * ===================================================================== */

const Num = ({ children, className = "" }) => (
  <span className={`tm-num tabular-nums ${className}`}>{children}</span>
);

const Badge = ({ children, className = "" }) => (
  <span className={className}>{children}</span>
);

const MetricCard = ({ label, value, className = "", valueClassName = "", labelClassName = "" }) => (
  <div className={className}>
    <Num className={valueClassName}>{value}</Num>
    <span className={labelClassName}>{label}</span>
  </div>
);

const GLASS = {
  surface:
    "rounded-[2rem] border border-white/90 bg-white/[0.74] shadow-[0_26px_76px_-56px_rgba(15,23,42,0.42)] backdrop-blur-xl ring-1 ring-slate-900/[0.02]",
  inner:
    "rounded-[1.35rem] border border-white/85 bg-white/[0.62] shadow-[0_18px_44px_-38px_rgba(15,23,42,0.32)] backdrop-blur-lg ring-1 ring-slate-900/[0.015]",
  interactive:
    "transition-all duration-200 hover:-translate-y-0.5 hover:border-white hover:bg-white/82 hover:shadow-[0_30px_84px_-58px_rgba(15,23,42,0.5)] active:translate-y-0 active:shadow-sm",
  padding: "p-6 sm:p-7",
};

const GlassPanel = ({ children, className = "" }) => (
  <div className={`${GLASS.surface} ${GLASS.padding} ${className}`}>
    {children}
  </div>
);

const BetaBadge = () => (
  <Badge className="inline-flex items-center gap-1 rounded-full border border-white/90 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm backdrop-blur sm:text-[11px]">
    β v0.3
  </Badge>
);

const PlatformBadge = () => (
  <Badge className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-teal-100/80 bg-white/75 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_10px_24px_-20px_rgba(15,118,110,0.6)] backdrop-blur-xl sm:gap-2 sm:px-3 sm:py-1.5 sm:text-[11px]">
    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
    <span>
      <span className="hidden sm:inline">AI Racing </span>
      <span className="sm:hidden">AI </span>
      Intelligence Platform
    </span>
    <span className="hidden text-slate-300 sm:inline">/</span>
    <span className="hidden sm:inline">β Sample Data</span>
  </Badge>
);

const Skeleton = ({ className = "" }) => (
  <div className={`animate-pulse rounded-lg bg-gray-100 ${className}`} />
);

const OFFICIAL_LOGO_SRC = "/logo-official.png";

const OfficialLogo = ({ className = "" }) => (
  <img
    src={OFFICIAL_LOGO_SRC}
    alt="TURF MATRIX"
    className={`h-9 w-[194px] flex-shrink-0 object-contain object-left sm:w-[212px] ${className}`}
    width="212"
    height="36"
  />
);

const Header = ({ onHome, meta }) => (
  <header className="sticky top-0 z-40 border-b border-white/80 bg-white/75 shadow-[0_12px_40px_-34px_rgba(15,23,42,0.35)] backdrop-blur-2xl">
    <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
      <button onClick={onHome} className="flex min-w-0 items-center" aria-label="トップへ戻る">
        <OfficialLogo />
      </button>
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <BetaBadge />
        {meta ? (
          <span className="hidden sm:inline">
            {meta.dateLabel} <span className="text-slate-300">/</span> <Num>{meta.updatedAt}</Num>
          </span>
        ) : null}
      </div>
    </div>
  </header>
);

const Footer = () => (
  <footer className="mt-20 border-t border-white/80 bg-white/55 backdrop-blur-2xl">
    <div className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-bold tracking-tight text-gray-900">
          TURF <span className="tm-gradient-text">MATRIX</span>
        </span>
        <BetaBadge />
        <PlatformBadge />
      </div>
      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-gray-500">
        本サービスは分析情報の提供を目的としており、的中や利益を保証するものではありません。
        馬券の購入はご自身の判断と責任でお願いします。20歳未満の方は馬券を購入できません。
      </p>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-gray-400">
        分析ポリシー: 人気を後追いする評価は行いません。AIは能力・血統・調教・ラップ・オッズ妙味などから
        期待値を独立に算出します。
      </p>
      <p className="mt-2 text-xs text-gray-400">
        β版のため、表示中のデータはすべてサンプルです。過去分析ログ(検証・回顧・回収率の透明化)は今後のバージョンで公開予定です。
      </p>
      <p className="mt-6 text-[11px] text-gray-400">© 2026 TURF MATRIX — AI Racing Intelligence Platform</p>
    </div>
  </footer>
);

/* ---- AnimatedBar: マウント時に0→値へ伸びる共通バー ---- */
const AnimatedBar = ({ value, delay = 0, trackClass = "bg-gray-100", heightClass = "h-1.5" }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`${heightClass} flex-1 overflow-hidden rounded-full ${trackClass}`}>
      <div
        className="tm-bar h-full rounded-full bg-teal-600"
        style={{ width: mounted ? `${value}%` : "0%", transitionDelay: `${delay}ms` }}
      />
    </div>
  );
};

/* ---- FactorBar: 横バー(レーダーチャートは不採用) ---- */
const FactorBar = ({ icon: Icon, label, value, delay = 0 }) => (
  <div className="flex items-center gap-3.5">
    <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-gray-500">
      {Icon && <Icon size={12} strokeWidth={1.75} className="shrink-0 text-gray-300" />}
      {label}
    </span>
    <AnimatedBar value={value} delay={delay} />
    <Num className={`w-9 shrink-0 text-right text-[13px] font-semibold ${scoreTone(value)}`}>{value}</Num>
  </div>
);

const TagList = ({ tags }) => (
  <div className="flex flex-wrap gap-1.5">
    {tags.map((t) => (
      <span
        key={t}
        className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600"
      >
        {t}
      </span>
    ))}
  </div>
);

/* ---- 5段階スター(信頼度 / TM VALUEで共用) ---- */
const StarRating = ({ value, size = 12, className = "" }) => (
  <span className={`inline-flex items-center gap-0.5 ${className}`} aria-label={`5段階中${value}`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star
        key={i}
        size={size}
        strokeWidth={1.5}
        className={i <= value ? "fill-emerald-500 text-emerald-500" : "fill-gray-200 text-gray-200"}
      />
    ))}
  </span>
);
const starText = (n) => "★".repeat(n) + "☆".repeat(5 - n);

const TMFactorsCard = () => (
  <div className={`mt-4 ${GLASS.inner} p-4`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">TM FACTORS v1</div>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          TM INDEXを7つの視点に分解するUIモックです。
        </p>
      </div>
      <span className="shrink-0 rounded-full border border-white/80 bg-white/65 px-2 py-0.5 text-[10px] font-medium text-slate-500">
        UI mock
      </span>
    </div>
    <div className="mt-4 grid gap-2.5 md:grid-cols-2">
      {TM_FACTOR_MOCKS.map((factor) => (
        <div key={factor.key} className="rounded-2xl border border-white/80 bg-white/60 p-3 shadow-[0_14px_34px_-30px_rgba(15,118,110,0.45)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-slate-900">{factor.label}</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-800/80"
                    style={{ width: `${Math.min(100, (factor.score / factor.maxScore) * 100)}%` }}
                  />
                </div>
                <StarRating value={factor.stars} size={9} />
              </div>
            </div>
            <Num className="shrink-0 text-[22px] font-bold leading-none text-slate-900">{factor.score}</Num>
          </div>
          <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-gray-500">{factor.summary}</p>
        </div>
      ))}
    </div>
  </div>
);

const CONF_STARS = { high: 4, mid: 3, low: 2 };
const ConfidenceIndicator = ({ level }) => {
  const c = CONFIDENCE[level];
  return (
    <div className="flex items-center gap-1.5" title={c.note}>
      <span className="text-[11px] text-gray-500">分析信頼度</span>
      <StarRating value={CONF_STARS[level]} size={10} />
      <span className="text-[11px] font-medium text-gray-700">{c.label}</span>
    </div>
  );
};

const SectionLabel = ({ icon: Icon, children }) => (
  <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
    {Icon && <Icon size={12} strokeWidth={1.75} className="shrink-0 text-teal-500/60" />}
    {children}
  </h4>
);

const ProsConsList = ({ pros, cons }) => (
  <div className="grid gap-5 sm:grid-cols-2">
    <div>
      <SectionLabel>プラス要因</SectionLabel>
      <ul className="mt-2 space-y-2">
        {pros.map((p, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
            <span className="mt-0.5 shrink-0 font-semibold text-emerald-600">＋</span>
            {p}
          </li>
        ))}
      </ul>
    </div>
    <div>
      <SectionLabel>マイナス要因</SectionLabel>
      <ul className="mt-2 space-y-2">
        {cons.map((c, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
            <span className="mt-0.5 shrink-0 font-semibold text-gray-400">−</span>
            {c}
          </li>
        ))}
      </ul>
    </div>
  </div>
);

/* ---- ファクター比較テーブル: 横=馬 / 縦=ファクター、色の濃淡で比較 ---- */
const heat = (ratio) => Math.max(0.04, Math.min(0.85, ratio));
const ComparisonTable = ({ horses, evMap, onSelect }) => {
  const sorted = [...horses].sort((a, b) => b.aiScore - a.aiScore);
  const cellValue = (d, h) =>
    d.type === "ev"
      ? evMap[h.id]?.ev ?? 0
      : d.type === "pedigree"
        ? pedigreeIndex(h.analysis.pedigree)
        : h.analysis.factors[d.key];
  const cellAlpha = (d, v) => (d.type === "ev" ? heat((v - 0.55) / 0.9) : heat((v - 45) / 55));
  return (
    <section className="mt-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Factor Matrix</div>
          <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">Horse Comparison</h2>
        </div>
        <span className="hidden text-right text-[11px] text-slate-400 md:block">濃いほど優位 ・ 横スクロール可</span>
      </div>
      <div className="mt-5 grid gap-3 md:hidden">
        {sorted.slice(0, 4).map((h) => {
          const factors = commandFactors(h, evMap[h.id]);
          return (
            <button
              key={h.id}
              onClick={() => onSelect(h)}
              className={`${GLASS.surface} ${GLASS.interactive} p-4 text-left`}
              aria-label={`${h.name}の詳細`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-2xl border border-white/90 bg-white/60">
                      <Num className="text-[12px] font-bold text-slate-600">{h.number}</Num>
                    </span>
                    <span className="truncate text-[16px] font-bold text-slate-950">{h.name}</span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-medium text-slate-400">
                    {h.jockey} ・ <Num>{h.popularity}</Num>人気
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">TM INDEX</div>
                  <Num className={`mt-1 block text-[36px] font-bold leading-none ${scoreTone(h.aiScore)}`}>
                    {h.aiScore}
                  </Num>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {factors.map((f) => (
                  <div key={f.key} className="rounded-[1.15rem] border border-white/80 bg-white/45 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-slate-400">{f.label}</span>
                      <Num className="text-[14px] font-bold text-slate-800">{f.value}</Num>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-slate-700/75" style={{ width: `${f.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <div className={`mt-4 hidden overflow-x-auto ${GLASS.surface} p-2 md:block`}>
        <table
          className="border-collapse text-center"
          style={{ minWidth: `${96 + sorted.length * 54}px`, width: "100%" }}
        >
          <thead>
            <tr>
              <th className="sticky left-0 z-10 rounded-l-2xl bg-white/80 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 backdrop-blur-xl">
                指数順
              </th>
              {sorted.map((h) => (
                <th key={h.id} className="px-1 py-2">
                  <button
                    onClick={() => onSelect(h)}
                    className="mx-auto flex w-full flex-col items-center gap-1"
                    aria-label={`${h.name}の詳細`}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/90 bg-white/75 shadow-sm">
                      <Num className="text-[11px] font-semibold text-gray-700">{h.number}</Num>
                    </span>
                    <span className="w-12 truncate text-[9px] font-medium leading-tight text-gray-500">
                      {h.name}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_DEFS.map((d) => (
              <tr key={d.key} className="border-t border-white/70">
                <th className="sticky left-0 z-10 whitespace-nowrap bg-white/80 px-3 py-1.5 text-left text-[11px] font-medium text-gray-500 backdrop-blur-xl">
                  {d.label}
                </th>
                {sorted.map((h) => {
                  const v = cellValue(d, h);
                  const a = cellAlpha(d, v);
                  return (
                    <td key={h.id} className="px-0.5 py-0.5">
                      <div
                        className="mx-auto flex h-8 w-[52px] items-center justify-center rounded-xl shadow-sm"
                        style={{ backgroundColor: `rgba(15, 118, 110, ${a})` }}
                      >
                        <Num
                          className={`text-[11px] font-semibold ${a > 0.45 ? "text-white" : "text-gray-700"}`}
                        >
                          {d.type === "ev" ? v.toFixed(2) : v}
                        </Num>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        馬名をタップすると分析詳細が開きます。期待値は推定勝率×単勝オッズ(1.00が損益分岐の目安)。
      </p>
    </section>
  );
};

/* ---- 期待値評価: 人気ではなく期待値で読む、というサービス思想の中核カード ---- */
const ValueCard = ({ ev, rank, popularity }) => {
  if (!ev) return null;
  const vs = valueStars(ev.ev);
  return (
    <div className="rounded-xl border border-teal-100 bg-white p-4 md:p-5">
      <div className="flex items-center justify-between">
        <SectionLabel icon={TrendingUp}>TM Value — 期待値評価</SectionLabel>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            ev.verdict.tone === "blue" ? "bg-teal-50 text-teal-700" : "bg-gray-100 text-gray-500"
          }`}
        >
          {ev.verdict.label}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <StarRating value={vs} size={18} />
        <Num className="text-[13px] font-bold text-gray-900">{vs}.0</Num>
        <span className="text-[11px] text-gray-400">/ 5</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-7 gap-y-3 border-t border-gray-100 pt-3.5">
        <div>
          <Num className={`block text-[24px] font-bold leading-none tracking-tight ${evTone(ev.ev)}`}>
            {ev.ev.toFixed(2)}
          </Num>
          <span className="mt-1.5 block text-[10px] text-gray-400">単勝期待値</span>
        </div>
        <div>
          <Num className="block text-[16px] font-semibold leading-none text-gray-800">
            {(ev.prob * 100).toFixed(1)}%
          </Num>
          <span className="mt-1.5 block text-[10px] text-gray-400">推定勝率</span>
        </div>
        <div>
          <span className="block text-[13px] font-semibold leading-none text-gray-800">
            指数<Num>{rank}</Num>位 / <Num>{popularity}</Num>人気
          </span>
          <span className="mt-1.5 block text-[10px] text-gray-400">市場評価との乖離</span>
        </div>
      </div>
      <p className="mt-3.5 text-[11px] leading-relaxed text-gray-400">
        推定勝率 × 単勝オッズで算出。<span className="font-medium text-gray-500">1.00が損益分岐の目安</span>です。
        本サービスは人気ではなく、期待値を分析します。
      </p>
    </div>
  );
};

/* ---- 血統評価: 4ライン分析(父系/母父系/母母父系/牝系) ---- */
const PedigreeCard = ({ pedigree }) => {
  const idx = pedigreeIndex(pedigree);
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5">
      <div className="flex items-center justify-between">
        <SectionLabel icon={Dna}>血統評価(4ライン)</SectionLabel>
        <span className="flex items-baseline gap-1">
          <Num className={`text-sm font-semibold ${scoreTone(idx)}`}>{idx}</Num>
          <span className="text-[10px] text-gray-400">血統指数</span>
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {pedigree.lines.map((l) => (
          <div key={l.role} className="flex gap-2.5 text-[12px] leading-relaxed">
            <span className="w-14 shrink-0 pt-px text-[10px] font-semibold tracking-wide text-gray-400">
              {l.role}
            </span>
            <span className="min-w-0 text-gray-600">
              <span className="font-semibold text-gray-800">{l.name}</span>
              <span className="text-gray-400"> — </span>
              {l.note}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 border-t border-gray-200/70 pt-3.5">
        {PEDIGREE_SCORE_DEFS.map((d, i) => (
          <div key={d.key}>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] text-gray-500">{d.label}</span>
              <Num className={`text-[12px] font-semibold ${scoreTone(pedigree.scores[d.key])}`}>
                {pedigree.scores[d.key]}
              </Num>
            </div>
            <div className="mt-1 flex">
              <AnimatedBar
                value={pedigree.scores[d.key]}
                delay={i * 40}
                heightClass="h-1"
                trackClass="bg-gray-200/70"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---- 調教評価カード: 「一週前重視・最終追いは確認材料」の思想を文言で明示 ---- */
const TrainingEvalCard = ({ evalData }) => (
  <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5">
    <div className="flex items-center justify-between">
      <SectionLabel icon={Dumbbell}>調教評価</SectionLabel>
      <span className="flex items-baseline gap-1">
        <Num className="text-lg font-semibold text-gray-900">{evalData.grade}</Num>
        <span className="text-[10px] text-gray-400">総合</span>
      </span>
    </div>

    <div className="mt-3 space-y-3">
      <div className="rounded-lg border border-teal-100 bg-white p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-gray-900">一週前追い切り</span>
            <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">主要評価</span>
          </div>
          <Num className={`text-sm font-semibold ${scoreTone(evalData.oneWeek.score)}`}>
            {evalData.oneWeek.score}
          </Num>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{evalData.oneWeek.text}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-gray-700">最終追い切り</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">確認材料</span>
          </div>
          <span className="text-[12px] font-medium text-gray-600">{evalData.final.status}</span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{evalData.final.text}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-gray-700">厩舎勝負調教パターン</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              evalData.stablePattern.match ? "bg-teal-50 text-teal-700" : "bg-gray-100 text-gray-500"
            }`}
          >
            {evalData.stablePattern.match ? "合致" : "非合致"}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{evalData.stablePattern.text}</p>
      </div>
    </div>

    <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
      評価方針: 本サービスは<span className="font-medium text-gray-500">一週前追い切りを主要評価</span>とし、
      最終追い切りは直前の状態を確かめる<span className="font-medium text-gray-500">確認材料</span>として扱います。
    </p>
  </div>
);

/* ---- 馬詳細の中身(モバイルシート / PCインライン展開で共有) ---- */
const HorseDetailContent = ({ horse, rank, fieldSize, ev, compactHeader = false, skipLeadInsight = false }) => {
  const a = horse.analysis;
  const tier = scoreTier(horse.aiScore);
  const bd = scoreBreakdown(horse);
  const insights = skipLeadInsight ? a.insight.slice(1) : a.insight;
  return (
    <div className="space-y-7">
      {/* TM INDEX — 指数のブランドブロック */}
      <GlassPanel className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-teal-100/60 blur-3xl" />
        <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            {compactHeader ? "TM INDEX Evidence" : "TURF MATRIX INDEX"}
          </span>
          {ev && (
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">TM Value</span>
              <StarRating value={valueStars(ev.ev)} size={11} />
            </span>
          )}
        </div>
        <div className={compactHeader ? "mt-3 flex flex-wrap items-center gap-2" : "mt-3 flex items-end justify-between gap-4"}>
          {!compactHeader && (
            <div className="flex items-baseline gap-2">
              <Num className={`text-[52px] font-bold leading-none tracking-tight md:text-[56px] ${scoreTone(horse.aiScore)}`}>
                {horse.aiScore}
              </Num>
              <span className="text-xs text-gray-400">/ 100</span>
            </div>
          )}
          <div className="flex flex-col items-end gap-1.5 pb-1">
            {rank != null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                Rank <Num className="font-bold text-teal-600">{rank}</Num>
                <span className="text-gray-400">/ {fieldSize}頭</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600">
              <Num className={`font-bold ${horse.aiScore >= 80 ? "text-emerald-600" : "text-gray-500"}`}>
                {tier.label}
              </Num>
              {tier.text}
            </span>
          </div>
        </div>

        {/* なぜこの指数なのか — 内訳の開示 */}
        <div className={`mt-4 ${GLASS.inner} p-4`}>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">指数の根拠</span>
            <span className="text-[10px] text-gray-400">ファクター × 重みの寄与</span>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1.5 md:grid-cols-4">
            {bd.items.map((it) => (
              <div key={it.label} className="flex items-baseline justify-between text-[12px]">
                <span className="text-gray-500">{it.label}</span>
                <Num className="font-semibold text-gray-800">+{it.value}</Num>
              </div>
            ))}
          </div>
          <div className="mt-2.5 space-y-1 border-t border-gray-100 pt-2">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-gray-400">総合補正(相手関係など)</span>
              <Num className="text-gray-500">{bd.adjust >= 0 ? `+${bd.adjust}` : bd.adjust}</Num>
            </div>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="font-medium text-gray-700">合計 TM INDEX</span>
              <Num className="font-bold text-gray-900">{horse.aiScore}</Num>
            </div>
          </div>
        </div>

        <TMFactorsCard />

        {/* 信頼度は必ず理由とセットで */}
        <div className={`mt-3 ${GLASS.inner} p-4`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">分析信頼度</span>
            <span className="flex items-center gap-1.5">
              <StarRating value={confidenceStars(a)} size={11} />
              <span className="text-[11px] font-medium text-gray-700">{CONFIDENCE[a.confidence].label}</span>
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {(a.confidenceReasons ?? [CONFIDENCE[a.confidence].note]).map((t, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-gray-600">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-gray-300" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        </div>
      </GlassPanel>

      {/* AI Insight — AIが今回最も伝えたいこと */}
      {insights.length > 0 && (
        <GlassPanel className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-10 -top-14 h-32 w-32 rounded-full bg-cyan-100/70 blur-3xl" />
          <div className="relative">
          <div className="flex items-center gap-1.5">
            <Sparkles size={13} strokeWidth={1.75} className="text-slate-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {skipLeadInsight ? "AI Insight Details" : "AI Insight"}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {insights.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-gray-700">
                <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                {t}
              </li>
            ))}
          </ul>
          </div>
        </GlassPanel>
      )}

      {/* 期待値評価(自動計算) */}
      <ValueCard ev={ev} rank={rank} popularity={horse.popularity} />

      <TagList tags={a.tags} />

      {/* 横バー型ファクター(血統は9項目から自動算出) */}
      <div>
        <SectionLabel icon={Activity}>ファクター指数</SectionLabel>
        <div className="mt-4 space-y-3">
          {FACTOR_DEFS.map((f, i) => (
            <FactorBar
              key={f.key}
              icon={f.icon}
              label={f.label}
              value={f.derived ? pedigreeIndex(a.pedigree) : a.factors[f.key]}
              delay={i * 60}
            />
          ))}
        </div>
      </div>

      {/* 血統評価(4ライン) */}
      <PedigreeCard pedigree={a.pedigree} />

      <ProsConsList pros={a.pros} cons={a.cons} />

      {/* AI総評 */}
      <div>
        <SectionLabel icon={MessageSquare}>AI総評</SectionLabel>
        <p className="mt-2.5 text-[13px] leading-[1.95] text-gray-700">{a.commentary}</p>
      </div>

      {/* 枠順評価 */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5">
        <div className="flex items-center justify-between">
          <SectionLabel icon={LayoutGrid}>枠順評価</SectionLabel>
          <Num className={`text-sm font-semibold ${scoreTone(a.frameEval.score)}`}>{a.frameEval.score}</Num>
        </div>
        <div className="mt-2.5 flex">
          <AnimatedBar value={a.frameEval.score} trackClass="bg-gray-200/70" />
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-gray-600">{a.frameEval.text}</p>
      </div>

      <TrainingEvalCard evalData={a.trainingEval} />
    </div>
  );
};

/* ---- モバイル: ボトムシート ----
 * スクロール対策:
 *  - 100vh問題: max-heightをdvh(fallback vh)で指定(.tm-sheet)
 *  - iOS慣性スクロール: -webkit-overflow-scrolling:touch(.tm-sheet)
 *  - 背面スクロール連鎖: overscroll-behavior:contain(.tm-sheet)
 *  - iOS Safariのbodyスクロール貫通: position:fixedロック + 位置復元
 */
const BottomSheet = ({ horse, rank, fieldSize, ev, onClose }) => {
  const sheetRef = useRef(null);
  const sheetBodyRef = useRef(null);
  const touchStartYRef = useRef(0);

  /* bodyスクロールロック(iOS対応: position:fixed方式 + スクロール位置復元) */
  useEffect(() => {
    const y = window.scrollY;
    const { style } = document.body;
    const htmlStyle = document.documentElement.style;
    const prev = {
      position: style.position, top: style.top, left: style.left,
      right: style.right, width: style.width, overflow: style.overflow,
      overscrollBehavior: style.overscrollBehavior,
      touchAction: style.touchAction,
    };
    const prevHtml = {
      overflow: htmlStyle.overflow,
      overscrollBehavior: htmlStyle.overscrollBehavior,
      touchAction: htmlStyle.touchAction,
    };
    const keepTouchInsideSheetBody = (e) => {
      const sheet = sheetRef.current;
      const sheetBody = sheetBodyRef.current;
      if (!sheet || !sheet.contains(e.target)) {
        e.preventDefault();
        return;
      }

      if (!sheetBody || !sheetBody.contains(e.target)) {
        e.preventDefault();
        return;
      }

      const currentY = e.touches?.[0]?.clientY ?? touchStartYRef.current;
      const deltaY = currentY - touchStartYRef.current;
      const atTop = sheetBody.scrollTop <= 0;
      const atBottom = sheetBody.scrollTop + sheetBody.clientHeight >= sheetBody.scrollHeight - 1;

      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        e.preventDefault();
      }
    };
    const rememberTouchStart = (e) => {
      touchStartYRef.current = e.touches?.[0]?.clientY ?? 0;
    };
    style.position = "fixed";
    style.top = `-${y}px`;
    style.left = "0";
    style.right = "0";
    style.width = "100%";
    style.overflow = "hidden";
    style.overscrollBehavior = "none";
    htmlStyle.overflow = "hidden";
    htmlStyle.overscrollBehavior = "none";
    document.addEventListener("touchstart", rememberTouchStart, { passive: true });
    document.addEventListener("touchmove", keepTouchInsideSheetBody, { passive: false });
    return () => {
      document.removeEventListener("touchstart", rememberTouchStart);
      document.removeEventListener("touchmove", keepTouchInsideSheetBody);
      Object.assign(style, prev);
      Object.assign(htmlStyle, prevHtml);
      window.scrollTo(0, y);
    };
  }, []);

  /* Escで閉じる */
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!horse) return null;
  const insightLead = horse.analysis?.insight?.[0];
  const command = commandFactors(horse, ev);
  const confidence = CONFIDENCE[horse.analysis.confidence];

  const modal = (
    <div className="tm-modal-root fixed inset-0 z-[9999] overflow-hidden overscroll-none" role="dialog" aria-modal="true" aria-label={`${horse.name}の分析詳細`}>
      <div className="tm-fade absolute inset-0 bg-slate-900/15 backdrop-blur-[3px]" onClick={onClose} />
      <div ref={sheetRef} className="tm-slideup tm-sheet absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[2rem] border-t border-white/90 bg-white/[0.9] shadow-[0_-34px_100px_-54px_rgba(15,118,110,0.62)] backdrop-blur-2xl">
        <div className="shrink-0 overflow-hidden border-b border-white/80 bg-white/[0.84] px-5 pb-5 pt-2.5 backdrop-blur-2xl">
          <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-emerald-100/75 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 bottom-0 h-36 w-36 rounded-full bg-cyan-100/70 blur-3xl" />
          <div className="relative">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-200" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">Top Signal</div>
                <div className="flex items-center gap-2">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/90 bg-white/75 shadow-sm">
                    <Num className="text-[15px] font-bold text-slate-700">{horse.number}</Num>
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-slate-950">{horse.name}</div>
                    <div className="mt-1 text-[11px] font-medium text-slate-500">
                      {horse.jockey} ・ <Num>{horse.popularity}</Num>人気 ・ 単勝 <Num>{horse.odds.toFixed(1)}</Num>
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/65 text-slate-400 shadow-sm transition-colors hover:bg-white hover:text-slate-600 active:bg-gray-100"
                aria-label="閉じる"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>

        <div
          ref={sheetBodyRef}
          className="tm-sheet-body min-h-0 flex-1 overflow-y-auto px-5 pt-5"
          style={{ paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
        >
          <div className="grid grid-cols-[1fr_auto] gap-4">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">TM INDEX</div>
              <Num className={`mt-3 block text-[48px] font-bold leading-none tracking-tight ${scoreTone(horse.aiScore)}`}>
                {horse.aiScore}
              </Num>
            </div>
            <div className="min-w-[112px] rounded-[1.35rem] border border-white/85 bg-white/52 px-3 py-3 text-right">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">TM VALUE</div>
              <div className={`mt-2 text-[18px] ${ev && ev.ev >= 1.15 ? "font-bold text-slate-900" : "text-gray-500"}`}>
                {ev ? (
                  <>
                    EV <Num>{ev.ev.toFixed(2)}</Num>
                  </>
                ) : (
                  "EV --"
                )}
              </div>
              {rank != null && (
                <div className="mt-1 text-[10px] text-gray-400">
                  Rank <Num>{rank}</Num> / {fieldSize}頭
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className={`${GLASS.inner} p-3.5`}>
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">Confidence</div>
              <div className="mt-2 text-[13px] font-bold text-slate-900">{confidence.label}</div>
            </div>
            <div className={`${GLASS.inner} p-3.5`}>
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">AI Verdict</div>
              <div className="mt-2 text-[13px] font-bold text-slate-900">{horse.aiScore >= 80 ? "Positive" : "Watch"}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {command.map((f) => (
              <div key={f.key} className="rounded-2xl border border-white/80 bg-white/45 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-slate-400">{f.label}</span>
                  <Num className="text-[15px] font-bold text-slate-800">{f.value}</Num>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-800/80" style={{ width: `${f.value}%` }} />
                </div>
              </div>
            ))}
          </div>

          {insightLead && (
            <div className="mt-4 flex gap-2 rounded-2xl border border-white/80 bg-white/45 px-3.5 py-3 text-[12px] leading-relaxed text-slate-600">
              <Sparkles size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-slate-400" />
              <span className="line-clamp-2">{insightLead}</span>
            </div>
          )}

          <HorseDetailContent
            horse={horse}
            rank={rank}
            fieldSize={fieldSize}
            ev={ev}
            compactHeader
            skipLeadInsight
          />
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

/* ---- 出走馬の1行(クリックで詳細) ---- */
const HorseRow = ({ horse, rank, fieldSize, ev, expanded, onToggle, isDesktop }) => (
  <div className="border-b border-white/70 last:border-b-0">
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      className={`block w-full px-4 py-4 text-left transition-colors duration-150 hover:bg-white/70 active:bg-gray-100/60 md:grid md:grid-cols-[2.5rem_1.4fr_1fr_4rem_4.5rem_4rem_1.6fr] md:items-center md:gap-x-3 md:px-5 md:py-3.5 ${
        expanded ? "bg-teal-50/45" : "bg-white/20"
      }`}
    >
      <span className="md:contents">
        <span className="flex items-start justify-between gap-3 md:contents">
          <span className="flex min-w-0 items-start gap-3 md:contents">
            {/* 馬番 */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/90 bg-white/75 shadow-sm md:h-8 md:w-8 md:rounded-xl">
              <Num className="text-[13px] font-semibold text-gray-700">{horse.number}</Num>
            </span>

            {/* 馬名 + (モバイル: 騎手/人気/オッズ) */}
            <span className="min-w-0 md:block">
              <span className="block truncate text-[16px] font-bold text-slate-950 md:text-[14px]">
                {horse.name}
              </span>
              <span className="mt-1 block text-[11px] text-gray-500 md:hidden">
                {horse.jockey} ・ <Num>{horse.popularity}</Num>人気 ・ 単勝 <Num>{horse.odds.toFixed(1)}</Num>
              </span>
            </span>
          </span>

          {/* AI指数(モバイルでは右端の主役) */}
          <span className="shrink-0 text-right md:hidden">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-400 md:hidden">
              TM INDEX
            </span>
            <Num className={`block text-[28px] font-bold leading-none tracking-tight ${scoreTone(horse.aiScore)}`}>
              {horse.aiScore}
            </Num>
          </span>
        </span>

        <span className="mt-3 flex items-center justify-between gap-3 border-t border-white/70 pt-3 md:hidden">
          <span className="min-w-0">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-400">TM VALUE</span>
            <span
              className={`mt-0.5 block text-[12px] ${
                ev && ev.ev >= 1.15 ? "font-semibold text-teal-600" : "text-gray-500"
              }`}
            >
              {ev ? (
                <>
                  EV <Num>{ev.ev.toFixed(2)}</Num> ・ {starText(valueStars(ev.ev))}
                </>
              ) : (
                "EV --"
              )}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-teal-600">
            詳細を見る
            <ChevronRight size={12} strokeWidth={1.75} />
          </span>
        </span>

        <span className="mt-2 block truncate text-[12px] text-gray-500 md:hidden">{horse.comment}</span>
      </span>

      {/* PC列: 騎手 / 人気 / オッズ+EV */}
      <span className="hidden truncate text-[13px] text-gray-600 md:block">{horse.jockey}</span>
      <span className="hidden text-right md:block">
        <Num className="text-[13px] text-gray-600">{horse.popularity}</Num>
        <span className="text-[11px] text-gray-400">人気</span>
      </span>
      <span className="hidden text-right md:block">
        <Num className="block text-[13px] text-gray-600">{horse.odds.toFixed(1)}</Num>
        {ev && (
          <Num
            className={`block text-[10px] leading-tight ${
              ev.ev >= 1.15 ? "font-semibold text-teal-600" : "text-gray-400"
            }`}
          >
            EV {ev.ev.toFixed(2)}
          </Num>
        )}
      </span>

      {/* PC列: AI指数 */}
      <span className="hidden text-right md:block">
        <Num className={`text-[19px] font-bold ${scoreTone(horse.aiScore)}`}>{horse.aiScore}</Num>
      </span>

      {/* PC列: 短評 */}
      <span className="hidden items-center justify-between gap-2 md:flex">
        <span className="truncate text-[12px] text-gray-500">{horse.comment}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          className={`shrink-0 text-gray-300 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </span>
    </button>

    {/* PC: インライン展開 */}
    {isDesktop && expanded && (
      <div className="tm-fadein border-t border-gray-100 bg-gray-50/40 px-5 py-7">
        <div className="mx-auto max-w-3xl">
          <HorseDetailContent horse={horse} rank={rank} fieldSize={fieldSize} ev={ev} />
        </div>
      </div>
    )}
  </div>
);

/* =====================================================================
 * [6] pages
 * ===================================================================== */

/* ---- トップページ ---- */
const HomePage = ({ onOpenRace }) => {
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [races, setRaces] = useState(null);
  const [featured, setFeatured] = useState(null);
  const [ranking, setRanking] = useState(null);

  useEffect(() => {
    dataProvider.getMeta().then(setMeta);
    dataProvider.getDailySummary().then(setSummary);
    dataProvider.getRaces().then(setRaces);
    dataProvider.getFeaturedHorses().then(setFeatured);
    dataProvider.getIndexRanking(5).then(setRanking);
  }, []);
  const topSignal = useMemo(() => {
    if (!races?.length) return null;
    return [...races].sort((a, b) => b.topHorse.aiScore - a.topHorse.aiScore)[0];
  }, [races]);

  return (
    <main className="mx-auto max-w-5xl px-5">
      {/* Hero */}
      <section className={`relative mt-6 overflow-hidden ${GLASS.surface} px-6 pb-8 pt-8 md:mt-10 md:px-10 md:pb-10 md:pt-10`}>
        <div className="pointer-events-none absolute -left-24 -top-20 h-56 w-56 rounded-full bg-cyan-100/45 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-20 h-52 w-52 rounded-full bg-emerald-100/45 blur-3xl" />
        <div className="pointer-events-none absolute inset-x-8 bottom-0 h-24 rounded-full bg-teal-50/55 blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">Today</span>
            <BetaBadge />
          </div>
          {topSignal ? (
            <>
              <div className="mt-9">
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">Top Signal</div>
                <div className="mt-4 truncate text-[20px] font-bold leading-tight tracking-tight text-slate-950 md:text-[30px]">
                  {topSignal.topHorse.name}
                </div>
              </div>
              <div className="mt-8 flex items-end justify-between gap-5">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">TM INDEX</div>
                  <Num className="mt-4 block text-[52px] font-bold leading-none tracking-tight text-emerald-600 md:text-[64px]">
                    {topSignal.topHorse.aiScore}
                  </Num>
                </div>
                <button
                  onClick={() => onOpenRace(topSignal.id)}
                  className="mb-4 inline-flex shrink-0 items-center gap-1 rounded-full border border-white/45 bg-white/15 px-2 py-1 text-[10px] font-semibold text-slate-400 backdrop-blur"
                >
                  View Analysis
                  <ChevronRight size={13} strokeWidth={1.75} />
                </button>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-3">
                <div className="rounded-[1.35rem] border border-white/80 bg-white/45 p-4">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">Confidence</div>
                  <div className="mt-2 text-[17px] font-bold text-slate-950">{CONFIDENCE[topSignal.confidence].label}</div>
                </div>
                <div className="rounded-[1.35rem] border border-white/80 bg-white/45 p-4">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">Race</div>
                  <div className="mt-2 truncate text-[17px] font-bold text-slate-950">{topSignal.name}</div>
                </div>
              </div>
            </>
          ) : (
            <Skeleton className="mt-8 h-64" />
          )}
        </div>
      </section>

      {/* 今日のレース */}
      <section className="mt-12">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">Race Intelligence</div>
            <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">今日のレース</h2>
          </div>
          <span className="text-[11px] font-medium text-slate-400">{meta?.venue}開催</span>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {races
            ? [...races]
                .sort((a, b) => b.number - a.number)
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onOpenRace(r.id)}
                    className={`group relative overflow-hidden ${GLASS.surface} ${GLASS.interactive} p-6 text-left`}
                  >
                    <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-emerald-100/45 blur-3xl" />
                    <div className="relative">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">Race Signal</div>
                        <div className="mt-3 truncate text-[16px] font-bold tracking-tight text-slate-950 md:text-[14px]">
                          {r.name}
                        </div>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/55 px-2 py-1 text-[11px] font-semibold text-slate-500">
                        詳細
                        <ChevronRight size={12} strokeWidth={1.75} />
                      </span>
                    </div>
                    <div className="mt-9">
                      <div className="flex items-end justify-between gap-4">
                        <div className="min-w-0">
                          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">Top Signal</span>
                          <span className="mt-2 block min-w-0 truncate text-[12px] font-bold text-slate-900">
                            {r.topHorse.name}
                          </span>
                        </div>
                        <Num className="shrink-0 text-[36px] font-bold leading-none tracking-tight text-emerald-600 md:text-[30px]">
                            {r.topHorse.aiScore}
                          </Num>
                      </div>
                      <div className="mt-6 flex items-center justify-between border-t border-white/70 pt-4">
                        <span className="text-[10px] font-medium text-slate-400">
                          <Clock size={10} strokeWidth={1.75} className="mr-1 inline-block align-[-1px]" />
                          <Num>{r.time}</Num> ・ {r.track}<Num>{r.number}</Num>R
                        </span>
                        <span className="text-[10px] font-medium text-slate-400">Confidence {CONFIDENCE[r.confidence].label}</span>
                      </div>
                    </div>
                    </div>
                  </button>
                ))
            : [0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}
        </div>
      </section>

      {/* AI分析サマリー */}
      <section className="mt-16">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Daily Intelligence</div>
            <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">AI分析サマリー</h2>
          </div>
        </div>
        <div className={`relative mt-4 overflow-hidden ${GLASS.surface} p-6`}>
          <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-cyan-100/70 blur-3xl" />
          {summary ? (
            <div className="relative">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/55 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                <Sparkles size={11} strokeWidth={1.75} />
                AI Insight
              </div>
              <p className="mt-4 text-[13px] leading-[2] text-slate-700">{summary.text}</p>
              <ul className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                {summary.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-slate-600">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
        </div>
      </section>

      {/* 今日のAI注目馬 */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900">今日のAI注目馬</h2>
          <span className="text-[11px] text-gray-400">AIが特に伝えたい3頭</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {featured
            ? featured.map((f, i) => {
                const isMain = i === 0;
                return (
                  <button
                    key={f.horseId}
                    onClick={() => onOpenRace(f.raceId, f.horseId)}
                    className={`group ${GLASS.surface} ${GLASS.interactive} text-left ${
                      isMain ? "p-6 md:col-span-2 md:p-8" : "p-5 md:p-6"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Num className="text-[10px] font-bold tracking-[0.18em] text-teal-600">
                            PICK 0{i + 1}
                          </Num>
                          <span className="text-[11px] text-gray-400">{f.raceLabel}</span>
                        </div>
                        <div
                          className={`mt-1.5 font-bold tracking-tight text-gray-900 ${
                            isMain ? "text-[22px]" : "text-[15px]"
                          }`}
                        >
                          {f.horse.name}
                        </div>
                        <p
                          className={`text-gray-500 ${
                            isMain
                              ? "mt-2.5 max-w-md text-[13px] leading-relaxed"
                              : "mt-2 text-[12px] leading-relaxed"
                          }`}
                        >
                          {f.note}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Num
                          className={`font-bold tracking-tight ${scoreTone(f.horse.aiScore)} ${
                            isMain ? "text-[52px] leading-none" : "text-[30px] leading-none"
                          }`}
                        >
                          {f.horse.aiScore}
                        </Num>
                        <div className="mt-1.5 text-[10px] uppercase tracking-wider text-gray-400">AI指数</div>
                        <span className="mt-1 flex items-center justify-end gap-1">
                          <StarRating value={valueStars(f.ev)} size={9} />
                        </span>
                        <Num className="mt-0.5 block text-[10px] text-gray-400">EV {f.ev.toFixed(2)}</Num>
                      </div>
                    </div>
                  </button>
                );
              })
            : [0, 1, 2].map((i) => (
                <Skeleton key={i} className={i === 0 ? "h-36 md:col-span-2" : "h-28"} />
              ))}
        </div>
      </section>

      {/* AI指数ランキング */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900">AI指数ランキング</h2>
          <span className="text-[11px] text-gray-400">本日 全レース</span>
        </div>
        <div className={`mt-4 overflow-hidden ${GLASS.surface}`}>
          {ranking
            ? ranking.map((item, i) => (
                <button
                  key={item.horse.id}
                  onClick={() => onOpenRace(item.raceId, item.horse.id)}
                  className="grid w-full grid-cols-[1.5rem_auto_1fr_2.5rem] items-center gap-3 border-b border-gray-100 px-4 py-3.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-gray-50/70 active:bg-gray-100/60 md:px-5"
                >
                  <Num className={`text-[13px] font-bold ${i === 0 ? "text-emerald-600" : "text-gray-400"}`}>
                    {i + 1}
                  </Num>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-gray-900">
                      {item.horse.name}
                    </span>
                    <span className="text-[11px] text-gray-400">{item.raceLabel}</span>
                  </span>
                  <span className="flex items-center">
                    <AnimatedBar value={item.horse.aiScore} delay={i * 70} />
                  </span>
                  <Num className={`text-right text-[15px] font-bold ${scoreTone(item.horse.aiScore)}`}>
                    {item.horse.aiScore}
                  </Num>
                </button>
              ))
            : [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-3 h-10" />)}
        </div>
      </section>
    </main>
  );
};

/* ---- レース詳細ページ ---- */
const RacePage = ({ raceId, initialHorseId, onBack }) => {
  const [race, setRace] = useState(null);
  const [sortKey, setSortKey] = useState("score");
  const [expandedId, setExpandedId] = useState(null); // PC: インライン展開
  const [sheetHorse, setSheetHorse] = useState(null); // モバイル: ボトムシート
  const isDesktop = useIsDesktop();

  /* Rank・期待値はロジック層で自動計算(手入力不要) */
  const rankMap = useMemo(() => (race ? rankByScore(race.horses) : {}), [race]);
  const topIndexHorse = useMemo(
    () => (race ? [...race.horses].sort((a, b) => b.aiScore - a.aiScore)[0] : null),
    [race]
  );
  const evMap = useMemo(
    () =>
      race
        ? Object.fromEntries(race.horses.map((h) => [h.id, evaluateValue(h, race.horses)]))
        : {},
    [race]
  );

  useEffect(() => {
    setRace(null);
    dataProvider.getRace(raceId).then((r) => {
      setRace(r);
      if (initialHorseId && r) {
        const h = r.horses.find((x) => x.id === initialHorseId);
        if (h) {
          if (window.matchMedia("(min-width: 768px)").matches) setExpandedId(h.id);
          else setSheetHorse(h);
        }
      }
    });
  }, [raceId, initialHorseId]);

  const handleToggle = useCallback(
    (horse) => {
      if (isDesktop) {
        setExpandedId((prev) => (prev === horse.id ? null : horse.id));
      } else {
        setSheetHorse(horse);
      }
    },
    [isDesktop]
  );

  const closeSheet = useCallback(() => setSheetHorse(null), []);

  return (
    <main className="mx-auto max-w-5xl px-5">
      {/* レースヘッダー */}
      <div className="pt-5 md:pt-6">
        <button
          onClick={onBack}
          className="-mx-2 -my-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 py-2 text-[13px] font-medium text-gray-500 transition-colors hover:text-gray-900 active:bg-gray-100/60"
        >
          <ChevronLeft size={15} strokeWidth={1.75} />
          トップへ戻る
        </button>

        {race ? (
          <div className={`relative mt-4 overflow-hidden ${GLASS.surface} p-5 md:p-7`}>
            <div className="pointer-events-none absolute -right-12 -top-14 h-40 w-40 rounded-full bg-emerald-100/70 blur-3xl" />
            <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/80 bg-white/70 px-2.5 py-1 text-gray-500 shadow-sm">
                    <Clock size={11} strokeWidth={1.75} />
                    <Num className="text-[12px] font-semibold text-slate-700">{race.time}</Num>
                  </span>
                  <span className="text-[13px] font-bold text-gray-900">
                    {race.track}
                    <Num>{race.number}</Num>R
                  </span>
                  {race.grade && (
                    <span className="rounded border border-slate-200 bg-white/50 px-1.5 py-px text-[10px] font-bold leading-4 text-slate-500">
                      {race.grade}
                    </span>
                  )}
                </div>
                <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-slate-950 md:text-[24px]">
                  {race.name}
                </h1>
              </div>
              <span className="mt-0.5 shrink-0 rounded-full border border-emerald-100 bg-emerald-50/75 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                分析済み
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium text-slate-500 md:gap-x-4">
              <span>
                {race.surface}
                <Num>{race.distance}</Num>m
              </span>
              <span>馬場 {race.going}</span>
              <span>
                <Num>{race.fieldSize}</Num>頭
              </span>
            </div>
            {topIndexHorse && (
              <div className={`mt-5 ${GLASS.inner} p-4`}>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">TM INDEX Top</span>
                    <span className="mt-1 block truncate text-[14px] font-bold text-slate-900">{topIndexHorse.name}</span>
                  </div>
                  <Num className="text-[38px] font-bold leading-none text-emerald-600">
                      {topIndexHorse.aiScore}
                    </Num>
                </div>
              </div>
            )}
            </div>
          </div>
        ) : (
          <Skeleton className="mt-4 h-24" />
        )}
      </div>

      {/* ファクター比較(全馬横断) */}
      {race && <ComparisonTable horses={race.horses} evMap={evMap} onSelect={handleToggle} />}

      {/* 並び替え(モバイル: 全幅・親指で押しやすい高さ) */}
      <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Runner Matrix</div>
          <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">出走馬 AI分析</h2>
        </div>
        <div className="grid w-full grid-cols-4 rounded-2xl border border-white/80 bg-white/65 p-1 shadow-sm backdrop-blur-xl md:flex md:w-auto md:rounded-2xl md:p-1">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setSortKey(o.key)}
              className={`rounded-lg px-2 py-2.5 text-[11px] font-semibold transition-colors duration-150 md:rounded-md md:px-3 md:py-1.5 ${
                sortKey === o.key
                  ? "bg-white text-teal-700 shadow-sm ring-1 ring-teal-100"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 出走馬一覧 */}
      <div className={`mt-4 overflow-hidden ${GLASS.surface}`}>
        {/* PC列ヘッダー */}
        <div className="hidden grid-cols-[2.5rem_1.4fr_1fr_4rem_4.5rem_4rem_1.6fr] gap-x-3 border-b border-gray-200 bg-gray-50/60 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 md:grid">
          <span>馬番</span>
          <span>馬名</span>
          <span>騎手</span>
          <span className="text-right">人気</span>
          <span className="text-right">単勝 / EV</span>
          <span className="text-right">AI指数</span>
          <span>短評</span>
        </div>

        {race
          ? sortHorses(race.horses, sortKey, evMap).map((h) => (
              <HorseRow
                key={h.id}
                horse={h}
                rank={rankMap[h.id]}
                fieldSize={race.fieldSize}
                ev={evMap[h.id]}
                expanded={expandedId === h.id}
                onToggle={() => handleToggle(h)}
                isDesktop={isDesktop}
              />
            ))
          : [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="m-3 h-14" />)}
      </div>

      <p className="mt-3 text-[11px] text-gray-400">
        {isDesktop ? "行をクリックすると分析詳細が展開されます。" : "馬をタップすると分析詳細が開きます。"}
        EVは推定勝率×単勝オッズの期待値(1.00が損益分岐の目安)です。
      </p>

      {/* モバイル: ボトムシート */}
      {!isDesktop && sheetHorse && (
        <BottomSheet
          horse={sheetHorse}
          rank={rankMap[sheetHorse.id]}
          fieldSize={race?.fieldSize}
          ev={evMap[sheetHorse.id]}
          onClose={closeSheet}
        />
      )}
    </main>
  );
};

/* =====================================================================
 * [7] App — 状態ベースの簡易ルーティング
 * 将来: Next.js の / と /race/[id] にそのまま対応
 * ===================================================================== */
export default function App() {
  const [route, setRoute] = useState({ page: "home" });
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    dataProvider.getMeta().then(setMeta);
  }, []);

  const openRace = (raceId, horseId = null) => {
    setRoute({ page: "race", raceId, horseId, key: Date.now() });
    window.scrollTo(0, 0);
  };
  const goHome = () => {
    setRoute({ page: "home" });
    window.scrollTo(0, 0);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f7fbfb] text-gray-900 antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&family=JetBrains+Mono:wght@500;600;700&display=swap');
        body, #root { font-family: 'Inter', 'Noto Sans JP', system-ui, sans-serif; }
        .tm-num { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        .tm-bar { transition: width 800ms cubic-bezier(0.22, 1, 0.36, 1); }
        button:focus-visible { outline: 2px solid rgba(15, 118, 110, 0.45); outline-offset: 2px; }
        .tm-modal-root {
          height: 100vh;
          height: 100dvh;
          contain: layout size style;
        }
        /* TURF MATRIX ブランド(Teal → Blue → Emerald) */
        .tm-gradient-text {
          background: linear-gradient(90deg, #00C2B8, #2D7BFF, #22E6A2);
          -webkit-background-clip: text; background-clip: text;
          color: transparent;
        }
        /* ボトムシートのスクロール対策(iOS Safari / Android Chrome) */
        .tm-sheet {
          height: 90vh;          /* 背面の一覧を10%ほど残す */
          height: 90dvh;         /* 100vh問題の回避(動的ビューポート) */
          max-height: 90vh;      /* dvh非対応ブラウザ向けフォールバック */
          max-height: 90dvh;
          overscroll-behavior: contain;
        }
        .tm-sheet-body {
          -webkit-overflow-scrolling: touch;  /* iOS慣性スクロール */
          overscroll-behavior: contain;       /* 背面へのスクロール連鎖を遮断 */
          touch-action: pan-y;
        }
        @keyframes tm-slideup { from { transform: translateY(24px); opacity: 0.6; } to { transform: translateY(0); opacity: 1; } }
        @keyframes tm-fade { from { opacity: 0; } to { opacity: 1; } }
        .tm-slideup { animation: tm-slideup 280ms cubic-bezier(0.22, 1, 0.36, 1); }
        .tm-fade { animation: tm-fade 200ms ease-out; }
        .tm-fadein { animation: tm-fade 240ms ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .tm-slideup, .tm-fade, .tm-fadein { animation: none; }
          .tm-bar { transition: none; }
        }
      `}</style>

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-28 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-cyan-100/55 blur-3xl" />
        <div className="absolute right-[-10rem] top-48 h-96 w-96 rounded-full bg-emerald-100/60 blur-3xl" />
        <div className="absolute bottom-20 left-[-10rem] h-80 w-80 rounded-full bg-teal-100/55 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-white/80" />
      </div>

      {DATA_ERRORS.length > 0 && (
        <div className="relative z-10 border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-[11px] text-amber-800">
          週次データの検証で <Num className="font-semibold">{DATA_ERRORS.length}</Num> 件の警告があります(開発者コンソール参照)
        </div>
      )}

      <div className="relative z-10">
        <Header onHome={goHome} meta={meta} />

        {route.page === "home" && <HomePage onOpenRace={openRace} />}
        {route.page === "race" && (
          <RacePage
            key={route.key}
            raceId={route.raceId}
            initialHorseId={route.horseId}
            onBack={goHome}
          />
        )}

        <Footer />
      </div>
    </div>
  );
}
