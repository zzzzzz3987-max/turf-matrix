from pathlib import Path
import argparse
from datetime import date as date_type
import json
import re

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_PATH = ROOT / "tools" / "week-data.json"
OUTPUT_DIR = ROOT / "docs" / "social"
FONT_REGULAR = r"C:\Windows\Fonts\YuGothR.ttc"
FONT_BOLD = r"C:\Windows\Fonts\YuGothB.ttc"

WIDTH = 1200
HEIGHT = 1600
NAVY = "#0A1021"
BLUE = "#2D7BFF"
TEAL = "#00C2B8"
GRAY_700 = "#374151"
GRAY_500 = "#6B7280"
GRAY_400 = "#9CA3AF"
GRAY_200 = "#E5E7EB"
GRAY_100 = "#F3F4F6"
BACKGROUND = "#FAFAFA"
WHITE = "#FFFFFF"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size=size)


def text_width(draw, value, text_font):
    box = draw.textbbox((0, 0), value, font=text_font)
    return box[2] - box[0]


def ellipsize(draw, value, text_font, max_width):
    if text_width(draw, value, text_font) <= max_width:
        return value
    result = value
    while result and text_width(draw, result + "…", text_font) > max_width:
        result = result[:-1]
    return result + "…"


def wrap_lines(draw, value, text_font, max_width, max_lines=2):
    lines = []
    remaining = value
    while remaining and len(lines) < max_lines:
        current = ""
        for character in remaining:
            if text_width(draw, current + character, text_font) > max_width:
                break
            current += character
        if not current:
            break
        lines.append(current)
        remaining = remaining[len(current):]
    if remaining and lines:
        lines[-1] = ellipsize(draw, lines[-1] + remaining, text_font, max_width)
    return lines


FACTOR_LABELS = {
    "ability": "能力指数",
    "blood": "血統指数",
    "training": "調教指数",
    "course": "コース指数",
    "distance": "距離指数",
    "pace": "展開指数",
    "stable": "厩舎指数",
    "form": "近走指数",
}


def previous_run_text(horse):
    past_runs = horse.get("pastRuns") or []
    if not past_runs:
        return "前走詳細は取得待ち"
    run = past_runs[0]
    race_name = run.get("raceName")
    if race_name:
        race_label = race_name
    else:
        race_label = f"{run.get('course') or ''}{run.get('surface') or ''}{run.get('distance') or ''}m"
    finish = run.get("confirmedFinishPosition") or run.get("finishPosition")
    finish_text = f"{finish}着" if isinstance(finish, (int, float)) else "着順未取得"
    margin = run.get("margin")
    if isinstance(margin, (int, float)) and margin > 0:
        detail = f"{margin:g}秒差"
    elif isinstance(run.get("last3F"), (int, float)):
        detail = f"上がり{run['last3F']:g}"
    else:
        detail = ""
    return "・".join(part for part in (f"{race_label} {finish_text}", detail) if part)


def overall_assessment(factors, confidence, horse, race):
    def score(key):
        value = factors.get(key, {})
        return value.get("score") if isinstance(value, dict) else value

    ability = score("ability")
    training = score("training")
    course = score("course")
    distance = score("distance")
    pace = score("pace")
    form = score("form")

    past_runs = horse.get("pastRuns") or []
    previous_surface = past_runs[0].get("surface") if past_runs else None
    current_surface = race.get("surface")
    if previous_surface and current_surface and previous_surface != current_surface:
        if current_surface == "芝":
            return "芝戻りで見直し"
        if current_surface in {"ダ", "ダート"}:
            return "ダート替わりで再評価"

    pace_analysis = horse.get("analysis", {}).get("pace", {})
    pace_fit = pace_analysis.get("scenarioFitAdjustment")
    if isinstance(pace_fit, (int, float)) and pace_fit >= 3:
        return f"{pace_analysis.get('expectedPace')}想定・{pace_analysis.get('style')}脚質が合う"

    if isinstance(training, (int, float)) and training <= 54:
        if all(isinstance(value, (int, float)) and value >= 80 for value in (course, distance)):
            return "コース・距離適性高"
        if all(isinstance(value, (int, float)) and value >= 72 for value in (distance, pace)):
            return "距離・展開適性高"
        if all(isinstance(value, (int, float)) and value >= 70 for value in (ability, form)):
            return "地力・近走内容を評価"
        return "取得済み材料で総合評価"
    if confidence in {"mid", "low"} and isinstance(distance, (int, float)) and distance >= 80:
        return "距離適性高・実績サンプル少"
    if isinstance(form, (int, float)) and form < 62:
        return "舞台適性高・近走反転が鍵"
    if all(isinstance(value, (int, float)) and value >= 70 for value in (ability, training)):
        return "地力・仕上がり良好"
    if all(isinstance(value, (int, float)) and value >= 78 for value in (course, distance)):
        return "コース・距離適性高"
    if isinstance(pace, (int, float)) and pace >= 75:
        return "条件適性高・展開も向く"
    if confidence in {"mid", "low"}:
        return "評価材料あり・信頼度慎重"
    return "各ファクター安定"


def pace_scenario_text(horse):
    pace = horse.get("analysis", {}).get("pace", {})
    expected = pace.get("expectedPace")
    style = pace.get("style")
    fit = pace.get("scenarioFitAdjustment")
    if not expected or not style or not isinstance(fit, (int, float)):
        return "展開データ取得待ち"
    if fit >= 3:
        fit_label = "有利"
    elif fit >= 1:
        fit_label = "やや有利"
    elif fit <= -3:
        fit_label = "不利"
    elif fit <= -1:
        fit_label = "やや不利"
    else:
        fit_label = "影響小"
    return f"{expected}想定・近走脚質 {style}・{fit_label}"


def comprehensive_review(horse, race):
    analysis = horse.get("analysis", {})
    factors = analysis.get("factorsDetail", {})
    scored = []
    for key, label in FACTOR_LABELS.items():
        score = factors.get(key, {}).get("score") if isinstance(factors.get(key), dict) else factors.get(key)
        if isinstance(score, (int, float)):
            scored.append((float(score), label))
    scored.sort(reverse=True)
    strengths = scored[:2]
    strength_text = "・".join(f"{label}{round(score):d}" for score, label in strengths)

    confidence = analysis.get("confidence")

    return [
        ("前走", previous_run_text(horse)),
        ("評価", strength_text or "分析中"),
        ("展開", pace_scenario_text(horse)),
    ]


def confidence_label(value, tm_index):
    if value == "high" and tm_index >= 80:
        grade = "S"
    elif value in {"high", "mid"}:
        grade = "A"
    elif value == "low":
        grade = "B"
    else:
        return ""
    return f"信頼度  {grade}"


def race_label(race):
    condition = f"{race.get('surface') or ''}{race.get('distance') or ''}m"
    return f"{race.get('track', '')}{race.get('number', '')}R  {condition}"


parser = argparse.ArgumentParser()
parser.add_argument("--data", type=Path, default=DEFAULT_DATA_PATH)
args = parser.parse_args()

with args.data.open(encoding="utf-8") as file:
    week = json.load(file)

leaders = []
for race in week.get("races", []):
    horses = [horse for horse in race.get("horses", []) if isinstance(horse.get("tmIndex"), (int, float))]
    horses.sort(key=lambda horse: (-horse["tmIndex"], horse.get("number") or 999))
    if not horses:
        continue
    leader = horses[0]
    leaders.append({
        "race": race,
        "horse": leader,
        "review": comprehensive_review(leader, race),
    })

leaders.sort(key=lambda item: item["race"].get("time") or "99:99")

image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
draw = ImageDraw.Draw(image)

# Header
draw.rectangle((0, 0, WIDTH, 226), fill=WHITE)
draw.line((0, 225, WIDTH, 225), fill=GRAY_200, width=2)
draw.text((64, 44), "TURF", fill=NAVY, font=font(30, True))
turf_width = text_width(draw, "TURF", font(30, True))
draw.text((64 + turf_width + 10, 44), "MATRIX", fill=BLUE, font=font(30, True))
draw.text((64, 94), "TM INDEX 1位", fill=NAVY, font=font(46, True))
date_value = str(week.get("meta", {}).get("date") or "")
try:
    parsed_date = date_type.fromisoformat(date_value)
    weekday = "月火水木金土日"[parsed_date.weekday()]
    subtitle = f"{parsed_date.month}月{parsed_date.day}日 {weekday}曜｜対象{len(leaders)}レース"
except ValueError:
    subtitle = f"対象{len(leaders)}レース"
draw.text((64, 168), subtitle, fill=GRAY_500, font=font(21))

draw.rounded_rectangle((903, 50, 1136, 116), radius=12, fill=NAVY)
draw.text((936, 67), "RACE INTELLIGENCE", fill=WHITE, font=font(17, True))
draw.line((904, 142, 1134, 142), fill=GRAY_200, width=5)
draw.line((904, 142, 1060, 142), fill=BLUE, width=5)

# Column labels
header_y = 246
draw.text((64, header_y), "RACE", fill=GRAY_400, font=font(16, True))
draw.text((335, header_y), "TOP RATED", fill=GRAY_400, font=font(16, True))
draw.text((615, header_y), "TM INDEX", fill=GRAY_400, font=font(16, True))
draw.text((755, header_y), "AI REVIEW", fill=GRAY_400, font=font(16, True))

row_top = 282
row_height = 111
for index, item in enumerate(leaders):
    race = item["race"]
    horse = item["horse"]
    y = row_top + index * row_height
    if index % 2 == 0:
        draw.rounded_rectangle((42, y - 4, 1158, y + row_height - 10), radius=10, fill=WHITE)
    draw.line((64, y + row_height - 10, 1136, y + row_height - 10), fill=GRAY_200, width=1)

    time_text = race.get("time") or "--:--"
    draw.text((64, y + 15), time_text, fill=NAVY, font=font(24, True))
    draw.text((150, y + 19), ellipsize(draw, race.get("name") or "", font(18, True), 165), fill=NAVY, font=font(18, True))
    draw.text((64, y + 55), race_label(race), fill=GRAY_500, font=font(17))
    if race.get("raceType") == "重賞":
        draw.rounded_rectangle((245, y + 53, 310, y + 81), radius=7, outline=BLUE, width=1)
        draw.text((258, y + 56), "重賞", fill=BLUE, font=font(14, True))

    draw.rounded_rectangle((335, y + 23, 381, y + 69), radius=10, fill=GRAY_100, outline=GRAY_200, width=1)
    number_text = str(horse.get("number") or "--")
    number_x = 358 - text_width(draw, number_text, font(19, True)) / 2
    draw.text((number_x, y + 31), number_text, fill=GRAY_700, font=font(19, True))
    draw.text((397, y + 16), ellipsize(draw, horse.get("name") or "", font(22, True), 205), fill=NAVY, font=font(22, True))
    conf = confidence_label(horse.get("analysis", {}).get("confidence"), horse["tmIndex"])
    if conf:
        draw.text((397, y + 55), conf, fill=GRAY_500, font=font(16))

    score = str(int(round(horse["tmIndex"])))
    draw.text((615, y + 7), score, fill=BLUE if horse["tmIndex"] >= 80 else NAVY, font=font(48, True))
    draw.text((682, y + 39), "/100", fill=GRAY_400, font=font(15))

    for line_index, (label, value) in enumerate(item["review"]):
        line_y = y + 9 + line_index * 27
        draw.text((755, line_y), label, fill=GRAY_400, font=font(14, True))
        draw.text((807, line_y), ellipsize(draw, value, font(15), 328), fill=GRAY_700, font=font(15))

# Footer
footer_y = 1518
draw.text((64, footer_y), "指数はレース内の相対評価です。馬券購入はご自身の判断と責任でお願いします。", fill=GRAY_500, font=font(16))
draw.text((1018, footer_y - 5), "turf-matrix.vercel.app", fill=BLUE, font=font(15, True))

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
output_date = date_value or "weekly"
output_path = OUTPUT_DIR / f"{output_date}-index-leaders.png"
image.save(output_path, format="PNG", optimize=True)
print(output_path)
