const FEMALE_LINE_RULES = [
  {
    id: "almahmoud",
    label: "Almahmoud牝系",
    terms: ["almahmoud", "アルマームード", "natalma", "ナタルマ", "cosmah", "コスマー"],
    traits: { speed: 0.9, power: 0.55, stamina: 0.45, sustain: 0.72 },
    fit: ["瞬発力", "トップスピード", "高速馬場", "中距離"],
    note: "スピードと瞬発力の源流として評価。軽い芝や加速性能が問われる条件で強み。",
  },
  {
    id: "la_troienne",
    label: "La Troienne牝系",
    terms: ["latroienne", "la troienne", "ラトロワンヌ", "busanda", "ブサンダ", "buckpasser", "バックパサー", "busher", "ブッシャー"],
    traits: { speed: 0.55, power: 0.95, stamina: 0.82, sustain: 0.82 },
    fit: ["パワー", "底力", "道悪", "急坂", "ダート"],
    note: "パワーと底力を補強。タフな馬場、急坂、消耗戦で評価を上げる牝系。",
  },
  {
    id: "somethingroyal",
    label: "Somethingroyal牝系",
    terms: ["somethingroyal", "サムシングロイヤル", "secretariat", "セクレタリアト", "sir gaylord", "サーゲイロード"],
    traits: { speed: 0.88, power: 0.58, stamina: 0.66, sustain: 0.74 },
    fit: ["トップスピード", "瞬発力", "高速馬場", "中距離"],
    note: "良質なスピードと加速性能を補強。軽い芝やスピード上限が問われる条件で評価。",
  },
  {
    id: "best_in_show",
    label: "Best in Show牝系",
    terms: ["bestinshow", "best in show", "ベストインショウ", "sex appeal", "セックスアピール", "try my best", "トライマイベスト"],
    traits: { speed: 0.84, power: 0.62, stamina: 0.55, sustain: 0.78 },
    fit: ["スピード", "瞬発力", "マイル", "中距離"],
    note: "軽快なスピードと反応の良さを補強。スピードを活かせる芝条件で評価。",
  },
  {
    id: "special",
    label: "Special牝系",
    terms: ["special", "スペシャル", "nureyev", "ヌレイエフ", "fairy bridge", "フェアリーブリッジ", "sadler's wells", "サドラーズウェルズ"],
    traits: { speed: 0.62, power: 0.78, stamina: 0.86, sustain: 0.88 },
    fit: ["持続戦", "スタミナ", "洋芝", "道悪", "底力"],
    note: "持続力と欧州的な底力を補強。タフな芝や長く脚を使う展開で評価。",
  },
  {
    id: "rough_shod",
    label: "Rough Shod牝系",
    terms: ["roughshod", "rough shod", "ラフショッド", "special", "lisadell", "リサデル"],
    traits: { speed: 0.68, power: 0.76, stamina: 0.82, sustain: 0.88 },
    fit: ["持続戦", "底力", "スタミナ", "洋芝"],
    note: "持続力と底力を補強。瞬発力だけではなく、長く脚を使う条件で評価。",
  },
];

export { FEMALE_LINE_RULES };
