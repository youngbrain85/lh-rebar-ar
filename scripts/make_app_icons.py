#!/usr/bin/env python3
"""두 앱의 1024px 아이콘을 생성한다.

발주처 요청으로 앱이 둘로 나뉘었는데(철근 AR 연구 / LH 철근검측) 아이콘이
같아서 홈 화면에서 구분이 안 됐다. 홈 화면 60px에서는 글자가 거의 안 읽히므로
**바탕색**으로 가른다 — 하나는 어둡고 하나는 주황이라 한눈에 갈린다.

  철근 AR 연구 : 차콜 바탕 + 흰 "AR" + 주황 띠   (기존 아이콘 계열 유지)
  LH 철근검측  : 주황 바탕 + 네이비 "검측" + 네이비 띠 (반전)

색은 docs/design-system.md 를 따른다 — 브리콘랩 네이비 #002961, 주황 #FF6B00.
판정 색(초록/빨강 등)은 쓰지 않는다.

실행: .venv/Scripts/python.exe scripts/make_app_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
CHARCOAL = (26, 26, 30)
NAVY = (0, 41, 97)
ORANGE = (255, 107, 0)
WHITE = (255, 255, 255)

# 맑은 고딕 — Windows 기본. 한글 글리프를 담고 있다.
KR_BOLD = "C:/Windows/Fonts/malgunbd.ttf"
LATIN_BOLD = "C:/Windows/Fonts/arialbd.ttf"

ROOT = Path(__file__).resolve().parents[1]


def font(path: str, px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, px)


def centered(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont,
             cy: int, fill: tuple[int, int, int]) -> None:
    """텍스트를 가로 중앙 + 지정한 세로 중심에 놓는다 (글리프 실제 bbox 기준)."""
    l, t, r, b = draw.textbbox((0, 0), text, font=f)
    draw.text((SIZE / 2 - (l + r) / 2, cy - (t + b) / 2), text, font=f, fill=fill)


def make(path: Path, bg, mark: str, mark_font: str, mark_px: int,
         mark_fill, band, caption: str, caption_fill) -> None:
    img = Image.new("RGB", (SIZE, SIZE), bg)
    d = ImageDraw.Draw(img)

    # 하단 띠 — 기존 아이콘의 조형을 이어받는다
    band_h = int(SIZE * 0.145)
    d.rectangle([0, SIZE - band_h, SIZE, SIZE], fill=band)

    # 주 마크: 60px 아이콘에서도 형태가 남는 크기
    centered(d, mark, font(mark_font, mark_px), int(SIZE * 0.42), mark_fill)
    # 캡션: 작은 크기에선 질감으로만 보이고 큰 크기에서 의미를 준다
    centered(d, caption, font(KR_BOLD, int(SIZE * 0.085)), int(SIZE * 0.735), caption_fill)

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    print(f"  {path.relative_to(ROOT)}")


def main() -> None:
    assets = ROOT / "LHRebarAR/Resources/Assets.xcassets"
    print("아이콘 생성:")
    # 연구과제 앱 — 어두운 바탕(기존 계열 유지). 이미 설치된 테스터의 인식을 깨지 않는다.
    make(
        assets / "AppIcon.appiconset/icon-1024.png",
        bg=CHARCOAL, mark="AR", mark_font=LATIN_BOLD, mark_px=int(SIZE * 0.42),
        mark_fill=WHITE, band=ORANGE, caption="철근 AR 연구", caption_fill=WHITE,
    )
    # LH 전용 앱 — 주황 바탕으로 반전. 색만으로 즉시 갈린다.
    make(
        assets / "AppIconLH.appiconset/icon-1024.png",
        bg=ORANGE, mark="검측", mark_font=KR_BOLD, mark_px=int(SIZE * 0.34),
        mark_fill=NAVY, band=NAVY, caption="LH 철근검측", caption_fill=NAVY,
    )


if __name__ == "__main__":
    main()
