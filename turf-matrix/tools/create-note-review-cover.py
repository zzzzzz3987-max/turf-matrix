from pathlib import Path
import argparse

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FONT_REGULAR = r"C:\Windows\Fonts\YuGothR.ttc"
FONT_BOLD = r"C:\Windows\Fonts\YuGothB.ttc"

WIDTH = 1280
HEIGHT = 670
NAVY = "#0A1021"
BLUE = "#2D7BFF"
GRAY_600 = "#4B5563"
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


parser = argparse.ArgumentParser()
parser.add_argument("--date", required=True)
parser.add_argument("--output", type=Path)
parser.add_argument("--day-label", default="SUNDAY")
parser.add_argument("--headline", default="TM INDEX 1位")
parser.add_argument("--subheadline", default="日曜10レースの検証")
parser.add_argument("--description", default="公開時点の評価と確定成績を、数字のまま振り返る。")
parser.add_argument("--panel-label", default="INDEX 1位 成績")
parser.add_argument("--panel-primary", default="3勝")
parser.add_argument("--panel-secondary", default="3着内 5/10")
parser.add_argument("--lower-note")
parser.add_argument(
    "--metric",
    action="append",
    nargs=2,
    metavar=("LABEL", "VALUE"),
    help="Result panel metric. May be passed up to three times.",
)
args = parser.parse_args()

output_path = args.output or ROOT / "docs" / "reviews" / "assets" / f"{args.date}-note-cover.png"
year, month, day = args.date.split("-")

image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
draw = ImageDraw.Draw(image)

# Quiet editorial frame
draw.rounded_rectangle((42, 38, 1238, 632), radius=18, fill=WHITE, outline=GRAY_200, width=2)
draw.rectangle((42, 38, 50, 632), fill=BLUE)

# Brand and report identity
draw.text((86, 76), "TURF", fill=NAVY, font=font(26, True))
turf_width = text_width(draw, "TURF", font(26, True))
draw.text((86 + turf_width + 9, 76), "MATRIX", fill=BLUE, font=font(26, True))
draw.text((86, 124), "RACE INTELLIGENCE REVIEW", fill=GRAY_400, font=font(15, True))

# Headline
draw.text((86, 190), args.headline, fill=NAVY, font=font(48, True))
draw.text((86, 254), args.subheadline, fill=NAVY, font=font(48, True))
draw.text((88, 330), args.description, fill=GRAY_600, font=font(21))
if args.lower_note:
    draw.text((88, 500), args.lower_note, fill=GRAY_500, font=font(18, True))

# Date and footer line
draw.line((86, 554, 1192, 554), fill=GRAY_200, width=2)
draw.text((86, 578), f"{year}.{month}.{day}  /  {args.day_label}", fill=GRAY_500, font=font(18, True))
footer = "AI Racing Intelligence Platform"
draw.text((1192 - text_width(draw, footer, font(17)), 580), footer, fill=GRAY_400, font=font(17))

# Results panel
panel_x = 790
panel_y = 104
panel_w = 402
panel_h = 400
draw.rounded_rectangle(
    (panel_x, panel_y, panel_x + panel_w, panel_y + panel_h),
    radius=14,
    fill=BACKGROUND,
    outline=GRAY_200,
    width=2,
)
draw.text((panel_x + 32, panel_y + 28), args.panel_label, fill=GRAY_500, font=font(17, True))
primary_font = font(58, True)
secondary_font = font(25, True)
primary_width = text_width(draw, args.panel_primary, primary_font)
secondary_width = text_width(draw, args.panel_secondary, secondary_font)
stack_panel_heading = primary_width > 140 or primary_width + secondary_width > panel_w - 96

draw.text((panel_x + 30, panel_y + 66), args.panel_primary, fill=BLUE, font=primary_font)
if stack_panel_heading:
    draw.text((panel_x + 32, panel_y + 132), args.panel_secondary, fill=NAVY, font=font(20, True))
    divider_y = panel_y + 178
    metrics_y = panel_y + 202
else:
    draw.text((panel_x + 174, panel_y + 88), args.panel_secondary, fill=NAVY, font=secondary_font)
    divider_y = panel_y + 154
    metrics_y = panel_y + 180

draw.line((panel_x + 30, divider_y, panel_x + panel_w - 30, divider_y), fill=GRAY_200, width=2)

metric_values = args.metric or [
    ("単勝回収率", "80.0%"),
    ("複勝回収率", "90.0%"),
    ("期待値表示・単勝回収率", "110.4%"),
]
metrics = tuple(
    (label, value, BLUE if index == len(metric_values) - 1 else NAVY)
    for index, (label, value) in enumerate(metric_values[:3])
)
for index, (label, value, color) in enumerate(metrics):
    y = metrics_y + index * 62
    draw.text((panel_x + 32, y), label, fill=GRAY_500, font=font(16, True))
    value_font = font(27, True)
    draw.text(
        (panel_x + panel_w - 32 - text_width(draw, value, value_font), y - 4),
        value,
        fill=color,
        font=value_font,
    )
    if index < len(metrics) - 1:
        draw.line((panel_x + 32, y + 46, panel_x + panel_w - 32, y + 46), fill=GRAY_200, width=1)

output_path.parent.mkdir(parents=True, exist_ok=True)
image.save(output_path, quality=96)
print(output_path)
