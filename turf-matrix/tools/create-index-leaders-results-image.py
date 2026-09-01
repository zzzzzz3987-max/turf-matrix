from pathlib import Path
import argparse
from datetime import date as date_type
import json

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FONT_REGULAR = r"C:\Windows\Fonts\YuGothR.ttc"
FONT_BOLD = r"C:\Windows\Fonts\YuGothB.ttc"

WIDTH = 1200
HEIGHT = 1600
NAVY = "#0A1021"
BLUE = "#2D7BFF"
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


def finish_label(position, abnormality_code):
    if abnormality_code != "0" or not isinstance(position, (int, float)) or position <= 0:
        return "競走除外"
    return f"{int(position)}着"


parser = argparse.ArgumentParser()
parser.add_argument("--date", required=True)
parser.add_argument("--review", type=Path)
parser.add_argument("--snapshot", type=Path)
parser.add_argument("--output", type=Path)
args = parser.parse_args()

review_path = args.review or ROOT / "data" / "archive" / f"{args.date}-review-data.json"
snapshot_path = args.snapshot or ROOT / "data" / "archive" / f"{args.date}-preodds.json"
output_path = args.output or ROOT / "docs" / "social" / f"{args.date}-index-leaders-results.png"

with review_path.open(encoding="utf-8") as file:
    review = json.load(file)
with snapshot_path.open(encoding="utf-8") as file:
    snapshot = json.load(file)

race_meta = {race.get("bundleId"): race for race in snapshot.get("races", [])}
rows = []
for race in review.get("races", []):
    leaders = race.get("indexTop3") or []
    if not leaders:
        continue
    leader = leaders[0]
    meta = race_meta.get(race.get("bundleId"), {})
    rows.append({
        "time": meta.get("time") or "--:--",
        "track": race.get("track") or meta.get("track") or "",
        "raceNo": race.get("raceNo") or meta.get("number") or "",
        "raceName": race.get("raceName") or meta.get("name") or "",
        "horseNumber": leader.get("horseNumber"),
        "horseName": leader.get("horseName") or "",
        "tmIndex": leader.get("tmIndex"),
        "popularity": leader.get("popularity"),
        "finishPosition": leader.get("finishPosition"),
        "abnormalityCode": str(leader.get("abnormalityCode") or "0"),
        "winPayout": leader.get("winPayout") or 0,
        "placePayout": leader.get("placePayout") or 0,
    })

rows.sort(key=lambda row: row["time"])
wins = sum(row["finishPosition"] == 1 and row["abnormalityCode"] == "0" for row in rows)
places = sum(
    isinstance(row["finishPosition"], (int, float))
    and 1 <= row["finishPosition"] <= 3
    and row["abnormalityCode"] == "0"
    for row in rows
)
stake = len(rows) * 100
win_return = sum(row["winPayout"] for row in rows)
place_return = sum(row["placePayout"] for row in rows)
win_return_rate = win_return / stake * 100 if stake else 0
place_return_rate = place_return / stake * 100 if stake else 0

image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
draw = ImageDraw.Draw(image)

draw.rectangle((0, 0, WIDTH, 272), fill=WHITE)
draw.line((0, 271, WIDTH, 271), fill=GRAY_200, width=2)
draw.text((64, 42), "TURF", fill=NAVY, font=font(30, True))
turf_width = text_width(draw, "TURF", font(30, True))
draw.text((64 + turf_width + 10, 42), "MATRIX", fill=BLUE, font=font(30, True))
draw.text((64, 91), "TM INDEX 1位｜RESULT", fill=NAVY, font=font(43, True))

parsed_date = date_type.fromisoformat(args.date)
weekday = "月火水木金土日"[parsed_date.weekday()]
draw.text((64, 162), f"{parsed_date.month}月{parsed_date.day}日 {weekday}曜｜対象{len(rows)}レース", fill=GRAY_500, font=font(21))

summary_x = 760
draw.text((summary_x, 48), "INDEX 1位 成績", fill=GRAY_400, font=font(16, True))
draw.text((summary_x, 82), f"{wins}勝", fill=BLUE, font=font(38, True))
draw.text((summary_x + 116, 89), f"3着内 {places}/{len(rows)}", fill=NAVY, font=font(26, True))
draw.text(
    (summary_x, 143),
    f"勝率 {wins / len(rows) * 100:.1f}%  ·  複勝率 {places / len(rows) * 100:.1f}%",
    fill=GRAY_500,
    font=font(18),
)
roi_top = 176
roi_width = 176
roi_height = 68
roi_gap = 16
for x, label, value in (
    (summary_x, "単勝回収率", win_return_rate),
    (summary_x + roi_width + roi_gap, "複勝回収率", place_return_rate),
):
    draw.rounded_rectangle(
        (x, roi_top, x + roi_width, roi_top + roi_height),
        radius=10,
        fill=BACKGROUND,
        outline=GRAY_200,
        width=1,
    )
    draw.text((x + 14, roi_top + 9), label, fill=GRAY_500, font=font(14, True))
    rate_text = f"{value:.1f}%"
    draw.text(
        (x + roi_width - 14 - text_width(draw, rate_text, font(27, True)), roi_top + 29),
        rate_text,
        fill=NAVY,
        font=font(27, True),
    )

header_y = 294
draw.text((64, header_y), "RACE", fill=GRAY_400, font=font(16, True))
draw.text((360, header_y), "TOP RATED", fill=GRAY_400, font=font(16, True))
draw.text((740, header_y), "TM INDEX", fill=GRAY_400, font=font(16, True))
draw.text((950, header_y), "RESULT", fill=GRAY_400, font=font(16, True))

row_top = 332
row_height = 106
for index, row in enumerate(rows):
    y = row_top + index * row_height
    if index % 2 == 0:
        draw.rounded_rectangle((42, y - 4, 1158, y + row_height - 10), radius=10, fill=WHITE)
    draw.line((64, y + row_height - 10, 1136, y + row_height - 10), fill=GRAY_200, width=1)

    draw.text((64, y + 14), row["time"], fill=NAVY, font=font(24, True))
    draw.text((150, y + 18), ellipsize(draw, row["raceName"], font(18, True), 184), fill=NAVY, font=font(18, True))
    draw.text((64, y + 54), f"{row['track']}{row['raceNo']}R", fill=GRAY_500, font=font(17))

    draw.rounded_rectangle((360, y + 22, 406, y + 68), radius=10, fill=GRAY_100, outline=GRAY_200, width=1)
    number = str(row["horseNumber"] or "--")
    number_x = 383 - text_width(draw, number, font(19, True)) / 2
    draw.text((number_x, y + 30), number, fill=GRAY_700, font=font(19, True))
    draw.text((422, y + 12), ellipsize(draw, row["horseName"], font(23, True), 290), fill=NAVY, font=font(23, True))
    popularity = f"{row['popularity']}人気" if row["popularity"] else "人気未取得"
    draw.text((422, y + 53), popularity, fill=GRAY_500, font=font(16))

    score = str(int(round(row["tmIndex"]))) if isinstance(row["tmIndex"], (int, float)) else "--"
    draw.text((740, y + 8), score, fill=BLUE if row["tmIndex"] >= 80 else NAVY, font=font(46, True))
    draw.text((804, y + 38), "/100", fill=GRAY_400, font=font(15))

    result = finish_label(row["finishPosition"], row["abnormalityCode"])
    is_winner = row["finishPosition"] == 1 and row["abnormalityCode"] == "0"
    result_color = BLUE if is_winner else NAVY
    result_width = text_width(draw, result, font(32, True))
    draw.text((1025 - result_width / 2, y + 20), result, fill=result_color, font=font(32, True))

footer_y = 1535
result_source = "JRA公式確定成績" if "JRA official" in review.get("analysisBasis", "") else "JV-Link確定成績"
draw.text((64, footer_y), f"公開時点のTM INDEXと{result_source}を照合。結果を後から書き換えず記録しています。", fill=GRAY_500, font=font(16))
brand = "turf-matrix.vercel.app"
draw.text((1136 - text_width(draw, brand, font(16, True)), footer_y), brand, fill=BLUE, font=font(16, True))

output_path.parent.mkdir(parents=True, exist_ok=True)
image.save(output_path, quality=96)
print(output_path)
