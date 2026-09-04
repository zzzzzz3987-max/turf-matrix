from pathlib import Path
from datetime import date as date_type
import json

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "tools" / "week-data.json"
OUTPUT_DIR = ROOT / "docs" / "social"
FONT_REGULAR = r"C:\Windows\Fonts\YuGothR.ttc"
FONT_BOLD = r"C:\Windows\Fonts\YuGothB.ttc"

WIDTH = 1200
HEIGHT = 1500
NAVY = "#081329"
BLUE = "#2678F3"
CYAN = "#13B8C4"
RED = "#D22645"
INK = "#172033"
MUTED = "#748096"
LINE = "#DDE3EC"
SOFT = "#F3F6FA"
WHITE = "#FFFFFF"
BG = "#F8FAFC"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size=size)


def text_width(draw, value, text_font):
    box = draw.textbbox((0, 0), str(value), font=text_font)
    return box[2] - box[0]


def fit_text(draw, value, text_font, max_width):
    value = str(value)
    if text_width(draw, value, text_font) <= max_width:
        return value
    while value and text_width(draw, value + "…", text_font) > max_width:
        value = value[:-1]
    return value + "…"


def race_name(value):
    aliases = {
        "京成杯オータムハンデ": "京成杯AH",
        "京成杯オータムハンデキャップ": "京成杯AH",
        "札幌２歳ステークス": "札幌2歳S",
        "エニフステークス": "エニフS",
        "西宮ステークス": "西宮S",
    }
    return aliases.get(value, value)


FACTOR_LABELS = {
    "ability": "能力",
    "blood": "血統",
    "training": "調教",
    "course": "コース",
    "distance": "距離",
    "load": "斤量",
    "pace": "展開",
    "stable": "厩舎",
    "form": "近走",
}


def key_point(horse):
    details = horse.get("analysis", {}).get("factorsDetail", {})
    ranked = []
    for key, label in FACTOR_LABELS.items():
        value = details.get(key)
        score = value.get("score") if isinstance(value, dict) else value
        if isinstance(score, (int, float)):
            ranked.append((float(score), label))
    ranked.sort(reverse=True)
    labels = [label for _, label in ranked[:2]]
    if len(labels) == 2:
        if "コース" in labels or "距離" in labels:
            return f"{labels[0]}・{labels[1]}適性を高評価"
        return f"{labels[0]}・{labels[1]}を高評価"
    if labels:
        return f"{labels[0]}を高評価"
    return "取得済み材料から総合評価"


def load_leaders():
    with DATA_PATH.open(encoding="utf-8") as file:
        week = json.load(file)
    leaders = []
    for race in week.get("races", []):
        horses = [horse for horse in race.get("horses", []) if isinstance(horse.get("tmIndex"), (int, float))]
        horses.sort(key=lambda horse: (-horse["tmIndex"], horse.get("number") or 999))
        if horses:
            leaders.append({"race": race, "horse": horses[0], "point": key_point(horses[0])})
    leaders.sort(key=lambda item: item["race"].get("time") or "99:99")
    return week, leaders


def date_label(week):
    raw = str(week.get("meta", {}).get("date") or "")
    try:
        parsed = date_type.fromisoformat(raw)
        weekday = "月火水木金土日"[parsed.weekday()]
        return f"{parsed.month}月{parsed.day}日 {weekday}曜"
    except ValueError:
        return raw


def base_canvas(title, subtitle, edition):
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 210), fill=WHITE)
    draw.line((0, 209, WIDTH, 209), fill=NAVY, width=3)
    draw.text((58, 38), "TM", fill=NAVY, font=font(36, True))
    draw.text((145, 40), "TURF MATRIX", fill=NAVY, font=font(25, True))
    draw.text((145, 76), "RACE INTELLIGENCE PLATFORM", fill=MUTED, font=font(12, True))
    draw.text((58, 116), title, fill=NAVY, font=font(39, True))
    draw.text((58, 169), subtitle, fill=MUTED, font=font(18))
    draw.rounded_rectangle((955, 36, 1140, 96), radius=8, fill=NAVY)
    draw.text((991, 54), edition, fill=WHITE, font=font(16, True))
    return image, draw


def footer(draw):
    draw.line((58, 1432, 1142, 1432), fill=LINE, width=1)
    draw.text((58, 1450), "TM INDEXは各レース内の相対評価です。", fill=MUTED, font=font(14))
    draw.text((936, 1448), "turf-matrix.vercel.app", fill=BLUE, font=font(14, True))


def draw_standard(week, leaders, output):
    image, draw = base_canvas("特別レース  指数1位一覧", f"{date_label(week)}｜全{len(leaders)}レース", "STANDARD")
    columns_y = 238
    draw.text((58, columns_y), "RACE", fill=MUTED, font=font(15, True))
    draw.text((322, columns_y), "TOP RATED", fill=MUTED, font=font(15, True))
    draw.text((710, columns_y), "TM INDEX", fill=MUTED, font=font(15, True))
    draw.text((880, columns_y), "KEY POINT", fill=MUTED, font=font(15, True))
    top = 272
    row_h = 126
    for index, item in enumerate(leaders):
        race, horse = item["race"], item["horse"]
        y = top + index * row_h
        if index % 2 == 0:
            draw.rounded_rectangle((40, y - 5, 1160, y + 111), radius=8, fill=WHITE)
        draw.line((58, y + 115, 1142, y + 115), fill=LINE, width=1)
        draw.text((58, y + 15), race.get("time") or "--:--", fill=NAVY, font=font(23, True))
        draw.text((145, y + 17), fit_text(draw, race_name(race.get("name") or ""), font(18, True), 160), fill=INK, font=font(18, True))
        detail = f"{race.get('track', '')}{race.get('number', '')}R  {race.get('surface', '')}{race.get('distance', '')}m"
        draw.text((58, y + 58), detail, fill=MUTED, font=font(16))
        draw.rounded_rectangle((322, y + 24, 370, y + 72), radius=9, fill=SOFT, outline=LINE)
        number = str(horse.get("number") or "-")
        draw.text((346 - text_width(draw, number, font(18, True)) / 2, y + 34), number, fill=INK, font=font(18, True))
        draw.text((390, y + 14), fit_text(draw, horse.get("name") or "", font(22, True), 285), fill=NAVY, font=font(22, True))
        draw.text((390, y + 55), "レース内 TM INDEX首位", fill=MUTED, font=font(15))
        score = int(round(horse["tmIndex"]))
        score_color = BLUE if score >= 80 else NAVY
        draw.text((710, y + 4), str(score), fill=score_color, font=font(49, True))
        draw.text((774, y + 42), "/100", fill=MUTED, font=font(14))
        draw.text((880, y + 19), fit_text(draw, item["point"], font(17, True), 250), fill=INK, font=font(17, True))
        draw.line((880, y + 56, 1118, y + 56), fill=LINE, width=5)
        draw.line((880, y + 56, 880 + int(238 * score / 100), y + 56), fill=CYAN, width=5)
    footer(draw)
    image.save(output, "PNG", optimize=True)


VENUE_COLORS = {"札幌": "#2678F3", "阪神": "#13B8C4", "中山": "#D22645"}


def draw_venues(week, leaders, output):
    image = Image.new("RGB", (WIDTH, HEIGHT), "#F2F5F9")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 226), fill=NAVY)
    draw.text((48, 32), "TM", fill=WHITE, font=font(37, True))
    draw.text((133, 35), "TURF MATRIX", fill=WHITE, font=font(24, True))
    draw.text((133, 70), "RACE INTELLIGENCE PLATFORM", fill="#9FB0C8", font=font(11, True))
    draw.text((48, 111), "3会場  TM INDEX 1位", fill=WHITE, font=font(40, True))
    draw.text((49, 171), f"{date_label(week)}  |  特別競走 {len(leaders)}レース", fill="#B8C5D8", font=font(17))
    draw.rounded_rectangle((942, 35, 1148, 96), radius=7, outline="#53647E", width=1)
    draw.text((983, 54), "BY VENUE", fill=WHITE, font=font(15, True))
    draw.line((0, 224, WIDTH, 224), fill=CYAN, width=4)
    groups = {venue: [item for item in leaders if item["race"].get("track") == venue] for venue in ("札幌", "阪神", "中山")}
    for col, venue in enumerate(("札幌", "阪神", "中山")):
        x = 40 + col * 386
        color = VENUE_COLORS[venue]
        draw.rounded_rectangle((x, 252, x + 348, 326), radius=8, fill=WHITE, outline=LINE)
        draw.rectangle((x, 252, x + 348, 258), fill=color)
        draw.text((x + 20, 274), venue, fill=NAVY, font=font(25, True))
        draw.text((x + 220, 281), f"{len(groups[venue])} RACES", fill=color, font=font(12, True))
        for row, item in enumerate(groups[venue]):
            race, horse = item["race"], item["horse"]
            y = 348 + row * 326
            draw.rounded_rectangle((x, y, x + 348, y + 296), radius=8, fill=WHITE, outline="#D4DCE8")
            draw.rectangle((x, y, x + 7, y + 296), fill=color)
            draw.text((x + 22, y + 20), race.get("time") or "--:--", fill=color, font=font(18, True))
            draw.text((x + 102, y + 22), f"{venue}{race.get('number', '')}R", fill=MUTED, font=font(14, True))
            draw.text((x + 22, y + 55), fit_text(draw, race_name(race.get("name") or ""), font(19, True), 295), fill=NAVY, font=font(19, True))
            detail = f"{race.get('surface', '')}{race.get('distance', '')}m"
            draw.rounded_rectangle((x + 268, y + 17, x + 325, y + 47), radius=5, fill="#F2F5F9")
            detail_x = x + 296 - text_width(draw, detail, font(12, True)) / 2
            draw.text((detail_x, y + 24), detail, fill=MUTED, font=font(12, True))
            draw.line((x + 22, y + 91, x + 325, y + 91), fill=LINE, width=1)
            draw.rounded_rectangle((x + 22, y + 113, x + 70, y + 161), radius=8, fill="#F2F5F9", outline=LINE)
            number = str(horse.get("number") or "-")
            draw.text((x + 46 - text_width(draw, number, font(18, True)) / 2, y + 123), number, fill=INK, font=font(18, True))
            draw.text((x + 86, y + 114), fit_text(draw, horse.get("name") or "", font(21, True), 236), fill=NAVY, font=font(21, True))
            draw.text((x + 87, y + 151), "TM INDEX 首位", fill=MUTED, font=font(12, True))
            score = int(round(horse["tmIndex"]))
            draw.text((x + 22, y + 188), "TM INDEX", fill=MUTED, font=font(12, True))
            draw.text((x + 22, y + 203), str(score), fill=color, font=font(43, True))
            draw.text((x + 84, y + 235), "/100", fill=MUTED, font=font(12))
            draw.line((x + 142, y + 225, x + 320, y + 225), fill=LINE, width=7)
            draw.line((x + 142, y + 225, x + 142 + int(178 * score / 100), y + 225), fill=color, width=7)
            draw.rounded_rectangle((x + 18, y + 258, x + 330, y + 282), radius=5, fill="#F5F7FA")
            point = fit_text(draw, item["point"], font(13, True), 285)
            draw.text((x + 30, y + 263), point, fill=INK, font=font(13, True))
    footer(draw)
    image.save(output, "PNG", optimize=True)


def draw_ranking(week, leaders, output):
    ranked = sorted(leaders, key=lambda item: (-item["horse"]["tmIndex"], item["race"].get("time") or "99:99"))
    image, draw = base_canvas("TM INDEX  LEADER BOARD", f"{date_label(week)}｜特別競走の指数首位を比較", "RANKING")
    top = 250
    row_h = 128
    medals = {1: ("01", BLUE), 2: ("02", CYAN), 3: ("03", "#627089")}
    for index, item in enumerate(ranked, start=1):
        race, horse = item["race"], item["horse"]
        y = top + (index - 1) * row_h
        fill = WHITE if index > 3 else "#F2F7FF"
        draw.rounded_rectangle((42, y, 1158, y + 110), radius=9, fill=fill, outline=LINE)
        rank_text, rank_color = medals.get(index, (f"{index:02d}", MUTED))
        draw.text((66, y + 30), rank_text, fill=rank_color, font=font(24, True))
        draw.text((130, y + 18), fit_text(draw, horse.get("name") or "", font(23, True), 295), fill=NAVY, font=font(23, True))
        race_text = f"{race.get('track', '')}{race.get('number', '')}R  {race_name(race.get('name') or '')}  {race.get('time') or ''}"
        draw.text((130, y + 60), fit_text(draw, race_text, font(15), 350), fill=MUTED, font=font(15))
        draw.rounded_rectangle((505, y + 27, 553, y + 75), radius=9, fill=WHITE, outline=LINE)
        number = str(horse.get("number") or "-")
        draw.text((529 - text_width(draw, number, font(18, True)) / 2, y + 37), number, fill=INK, font=font(18, True))
        score = int(round(horse["tmIndex"]))
        draw.text((606, y + 9), str(score), fill=rank_color if index <= 3 else NAVY, font=font(50, True))
        draw.text((672, y + 48), "/100", fill=MUTED, font=font(14))
        draw.line((748, y + 42, 1116, y + 42), fill=LINE, width=8)
        draw.line((748, y + 42, 748 + int(368 * score / 100), y + 42), fill=rank_color if index <= 3 else BLUE, width=8)
        draw.text((748, y + 64), fit_text(draw, item["point"], font(15, True), 368), fill=INK, font=font(15, True))
    footer(draw)
    image.save(output, "PNG", optimize=True)


week, leaders = load_leaders()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
raw_date = str(week.get("meta", {}).get("date") or "weekly")
outputs = [
    OUTPUT_DIR / f"{raw_date}-index-leaders-x-a-standard.png",
    OUTPUT_DIR / f"{raw_date}-index-leaders-x-b-venue.png",
    OUTPUT_DIR / f"{raw_date}-index-leaders-x-c-ranking.png",
]
draw_standard(week, leaders, outputs[0])
draw_venues(week, leaders, outputs[1])
draw_ranking(week, leaders, outputs[2])
for output in outputs:
    print(output)
