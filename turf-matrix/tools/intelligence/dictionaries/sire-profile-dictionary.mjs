const normalizeSireName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[＊*$.'’\-\s]+/g, "")
    .trim();

const profile = (id, names, ancestry, traits, summary) => ({
  id,
  names,
  ancestry,
  traits,
  summary,
  sourceType: "curated_pedigree_knowledge",
  scoreApplied: false,
});

const SIRE_PROFILES = [
  profile("saturnalia", ["サートゥルナーリア", "Saturnalia"], ["ロードカナロア", "シーザリオ"], ["切れ味", "スピード", "中距離性能"], "ロードカナロア由来のスピードに、シーザリオ牝系の切れ味と中距離性能を重ねる構成です。"),
  profile("epiphaneia", ["エピファネイア", "Epiphaneia"], ["シンボリクリスエス", "シーザリオ"], ["パワー", "持続力", "中距離性能"], "Roberto系のパワーと持続力に、シーザリオ牝系の中距離性能と機動力を重ねる構成です。"),
  profile("bricks_and_mortar", ["ブリックスアンドモルタル", "Bricks and Mortar"], ["Giant's Causeway", "Beyond the Waves"], ["パワー", "持続力", "芝適性"], "Giant's Causewayを経るStorm Cat系のパワーと持続力を軸に、芝で長く脚を使う性質を伝える構成です。"),
  profile("orfevre", ["オルフェーヴル", "Orfevre"], ["ステイゴールド", "オリエンタルアート"], ["スタミナ", "持続力", "道悪対応"], "Stay Gold系のスタミナと持続力に、母系のパワーを重ねる中長距離型の構成です。"),
  profile("silver_state", ["シルバーステート", "Silver State"], ["ディープインパクト", "シルヴァースカヤ"], ["スピード", "切れ味", "マイル適性"], "Deep Impact由来のスピードと切れ味を中心に、芝のマイルから中距離へつながる構成です。"),
  profile("drefong", ["ドレフォン", "Drefong"], ["Gio Ponti", "Eltimaas"], ["スピード", "パワー", "ダート適性"], "Storm Cat系の先行スピードとパワーを軸に、短距離からマイルのダート適性を伝える構成です。"),
  profile("mikki_isle", ["ミッキーアイル", "Mikki Isle"], ["ディープインパクト", "スターアイル"], ["先行力", "スピード", "短距離適性"], "Deep Impact系のスピードに、母系の前向きさを重ねた短距離・マイル型の構成です。"),
  profile("lord_kanaloa", ["ロードカナロア", "Lord Kanaloa"], ["キングカメハメハ", "レディブラッサム"], ["スピード", "持続力", "短距離適性"], "King Kamehameha系の機動力とパワーに、母系の速度持続力を重ねた短距離・マイル型です。"),
  profile("kizuna", ["キズナ", "Kizuna"], ["ディープインパクト", "キャットクイル"], ["切れ味", "持続力", "中距離性能"], "Deep Impact由来の切れ味に、Storm Catを持つ母系のパワーと持続力を補う構成です。"),
  profile("satono_aladdin", ["サトノアラジン", "Satono Aladdin"], ["ディープインパクト", "マジックストーム"], ["スピード", "切れ味", "マイル適性"], "Deep Impactのトップスピードに、Storm Cat系のパワーを重ねた芝マイル寄りの構成です。"),
  profile("tower_of_london", ["タワーオブロンドン", "Tower of London"], ["Raven's Pass", "スノーパイン"], ["スピード", "パワー", "短距離適性"], "Raven's Pass由来のスピードに、母系の欧州型持続力を重ねた短距離・マイル型の構成です。"),
  profile("big_arthur", ["ビッグアーサー", "Big Arthur"], ["サクラバクシンオー", "シヤボナ"], ["先行力", "スピード", "短距離適性"], "Sakura Bakushin O系の純粋な短距離スピードに、母系のパワーを補うスプリント型です。"),
  profile("henny_hughes", ["ヘニーヒューズ", "Henny Hughes"], ["Hennessy", "Meadow Flyer"], ["先行力", "スピード", "ダート適性"], "Hennessyを経るStorm Cat系の先行スピードとパワーを強く伝えるダート短距離型です。"),
  profile("maurice", ["モーリス", "Maurice"], ["スクリーンヒーロー", "メジロフランシス"], ["パワー", "持続力", "マイル適性"], "Roberto系のパワーと持続力に、メジロ牝系のスタミナを重ねるマイル・中距離型です。"),
  profile("real_steel", ["リアルスティール", "Real Steel"], ["ディープインパクト", "ラヴズオンリーミー"], ["切れ味", "持続力", "中距離性能"], "Deep Impactの切れ味に、Storm Catを持つ母系のパワーと持続力を重ねる構成です。"),
  profile("rey_de_oro", ["レイデオロ", "Rey de Oro"], ["キングカメハメハ", "ラドラーダ"], ["機動力", "持続力", "中距離性能"], "King Kamehameha系の機動力とパワーに、牝系の中距離性能を重ねる構成です。"),
  profile("frankel", ["Frankel", "フランケル"], ["Galileo", "Kind"], ["スピード", "持続力", "欧州適性"], "Galileo系の持続力とスタミナに、Danehillを持つ母系のスピードを重ねる欧州型です。"),
  profile("curren_black_hill", ["カレンブラックヒル", "Curren Black Hill"], ["ダイワメジャー", "チャールストンハーバー"], ["先行力", "パワー", "マイル適性"], "Daiwa Major系の先行スピードとパワーを受け継ぐ短距離・マイル型です。"),
  profile("gold_ship", ["ゴールドシップ", "Gold Ship"], ["ステイゴールド", "ポイントフラッグ"], ["スタミナ", "持続力", "道悪対応"], "Stay Gold系のスタミナと持続力に、母系の底力を重ねる中長距離型です。"),
  profile("copano_rickey", ["コパノリッキー", "Copano Rickey"], ["ゴールドアリュール", "コパノニキータ"], ["先行力", "パワー", "ダート適性"], "Gold Allure系のダート適性と先行力に、母系の北米型パワーを重ねる構成です。"),
  profile("screen_hero", ["スクリーンヒーロー", "Screen Hero"], ["グラスワンダー", "ランニングヒロイン"], ["パワー", "持続力", "中距離性能"], "Grass Wonderを経るRoberto系のパワーと持続力を中心とする中距離型です。"),
  profile("suave_richard", ["スワーヴリチャード", "Suave Richard"], ["ハーツクライ", "ピラミマ"], ["持続力", "パワー", "中距離性能"], "Heart's Cry系の持続力に、Unbridled's Songを持つ母系のスピードとパワーを重ねます。"),
  profile("daiwa_major", ["ダイワメジャー", "Daiwa Major"], ["サンデーサイレンス", "スカーレットブーケ"], ["先行力", "パワー", "マイル適性"], "Sunday Silenceのスピードに、スカーレット牝系のパワーと持続力を重ねるマイル型です。"),
  profile("duramente", ["ドゥラメンテ", "Duramente"], ["キングカメハメハ", "アドマイヤグルーヴ"], ["スピード", "パワー", "中距離性能"], "King Kamehameha系のスピードとパワーに、Admire Groove牝系の持続力を重ねる構成です。"),
  profile("mind_your_biscuits", ["マインドユアビスケッツ", "Mind Your Biscuits"], ["Posse", "Jazzmane"], ["スピード", "パワー", "ダート適性"], "Deputy Minister系へつながる父系のスピードとパワーを軸にしたダート短距離・マイル型です。"),
  profile("leontes", ["リオンディーズ", "Leontes"], ["キングカメハメハ", "シーザリオ"], ["機動力", "パワー", "中距離性能"], "King Kamehameha系の機動力とパワーに、シーザリオ牝系の中距離性能を重ねます。"),
  profile("le_vent_se_leve", ["ルヴァンスレーヴ", "Le Vent Se Leve"], ["シンボリクリスエス", "マエストラーレ"], ["パワー", "持続力", "ダート適性"], "Symboli Kris Sを経るRoberto系のパワーと持続力を軸にしたダート中距離型です。"),

  profile("deep_impact", ["ディープインパクト", "Deep Impact"], ["サンデーサイレンス", "ウインドインハーヘア"], ["切れ味", "トップスピード", "中距離性能"], "Sunday Silenceの瞬発力に、母系の欧州型スタミナを重ねる芝中距離型です。"),
  profile("king_kamehameha", ["キングカメハメハ", "King Kamehameha"], ["Kingmambo", "マンファス"], ["機動力", "パワー", "持続力"], "Kingmambo系のスピードとパワーに、母系の持続力を重ねる万能型です。"),
  profile("kurofune", ["クロフネ", "Kurofune"], ["French Deputy", "Blue Avenue"], ["スピード", "パワー", "ダート適性"], "Deputy Minister系のパワーと先行スピードを中心に、芝・ダート双方へ対応する構成です。"),
  profile("gold_allure", ["ゴールドアリュール", "Gold Allure"], ["サンデーサイレンス", "ニキーヤ"], ["先行力", "パワー", "ダート適性"], "Sunday Silenceのスピードに、Nureyevを持つ母系のパワーを重ねたダート型です。"),
  profile("hearts_cry", ["ハーツクライ", "Heart's Cry", "Hearts Cry"], ["サンデーサイレンス", "アイリッシュダンス"], ["持続力", "スタミナ", "中距離性能"], "Sunday Silenceの瞬発力に、母系のスタミナと長く脚を使う持続力を重ねます。"),
  profile("harbinger", ["ハービンジャー", "Harbinger"], ["Dansili", "Penang Pearl"], ["パワー", "持続力", "洋芝適性"], "Danehill系のスピードに、欧州型のパワーと持続力を重ねる芝中距離型です。"),
  profile("symboli_kris_s", ["シンボリクリスエス", "Symboli Kris S"], ["Kris S.", "Tee Kay"], ["パワー", "持続力", "中距離性能"], "Roberto系のパワーと持続力を強く伝える中距離型です。"),
  profile("manhattan_cafe", ["マンハッタンカフェ", "Manhattan Cafe"], ["サンデーサイレンス", "サトルチェンジ"], ["スタミナ", "持続力", "長距離適性"], "Sunday Silenceの瞬発力に、母系のスタミナを重ねる中長距離型です。"),
  profile("majestic_warrior", ["Majestic Warrior", "マジェスティックウォリアー"], ["A.P. Indy", "Dream Supreme"], ["パワー", "先行力", "ダート適性"], "A.P. Indy系のパワーと持続力を中心とするダート型です。"),
  profile("tapit", ["Tapit", "タピット"], ["Pulpit", "Tap Your Heels"], ["スピード", "パワー", "ダート適性"], "A.P. Indy系の持続力に、Unbridled系を持つ母系のスピードとパワーを重ねます。"),
  profile("admire_moon", ["アドマイヤムーン", "Admire Moon"], ["エンドスウィープ", "マイケイティーズ"], ["スピード", "機動力", "短距離適性"], "End Sweep系のスピードと機動力を中心とする短距離・マイル型です。"),
  profile("south_vigorous", ["サウスヴィグラス", "South Vigorous"], ["エンドスウィープ", "ダーケストスター"], ["先行力", "パワー", "ダート適性"], "End Sweep系の先行スピードとパワーを強く伝えるダート短距離型です。"),
  profile("sunday_silence", ["サンデーサイレンス", "Sunday Silence"], ["Halo", "Wishing Well"], ["切れ味", "持続力", "芝適性"], "Halo系の瞬発力と勝負根性を日本の芝へ広く伝えた基幹血統です。"),
  profile("stay_gold", ["ステイゴールド", "Stay Gold"], ["サンデーサイレンス", "ゴールデンサッシュ"], ["スタミナ", "持続力", "道悪対応"], "Sunday Silence系の中でもスタミナと持続力、タフな条件への対応力を伝えます。"),
  profile("special_week", ["スペシャルウィーク", "Special Week"], ["サンデーサイレンス", "キャンペンガール"], ["スタミナ", "持続力", "中距離性能"], "Sunday Silenceの瞬発力に、母系のスタミナと持続力を重ねる中長距離型です。"),
  profile("neo_universe", ["ネオユニヴァース", "Neo Universe"], ["サンデーサイレンス", "ポインテッドパス"], ["パワー", "持続力", "中距離性能"], "Sunday Silence系の中でもパワーと持続力を備える中距離型です。"),
  profile("french_deputy", ["フレンチデピュティ", "French Deputy"], ["Deputy Minister", "Mitterand"], ["パワー", "先行力", "ダート適性"], "Deputy Minister系のパワーと先行力を伝える芝・ダート兼用型です。"),
  profile("real_impact", ["リアルインパクト", "Real Impact"], ["ディープインパクト", "トキオリアリティー"], ["スピード", "持続力", "マイル適性"], "Deep Impactのトップスピードに、母系の短距離スピードを重ねるマイル型です。"),
];

const findSireProfile = (name) => {
  const normalized = normalizeSireName(name);
  return SIRE_PROFILES.find((profile) =>
    profile.names.some((candidate) => normalizeSireName(candidate) === normalized)
  ) ?? null;
};

export { SIRE_PROFILES, findSireProfile, normalizeSireName };
