"""Render the sndemo mark to every icon size Expo needs."""
import pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
ASSETS = HERE.parent
inner = (HERE / "mark.svg").read_text()
inner = inner[inner.index(">") + 1 : inner.rindex("</svg>")]
BLUE = "#e9f1fe"

def page(size, body, bg):
    return (f'<html><body style="margin:0;background:{bg}">'
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 100 100">{body}</svg></body></html>')

def scaled(k, dy=0):
    return f'<g transform="translate({50-50*k} {50-50*k+dy}) scale({k})">{inner}</g>'

def mono(s):
    return s.replace('#2f6fe0', '#000').replace('#245bc0', '#000').replace('#fbfdff', '#fff')

JOBS = [
    ("icon.png", 1024, scaled(0.72), BLUE, False),
    ("splash-icon.png", 1024, scaled(0.8), "", True),
    ("android-icon-foreground.png", 512, scaled(0.56), "", True),
    ("android-icon-background.png", 512, "", BLUE, False),
    ("android-icon-monochrome.png", 432, mono(scaled(0.56)), "", True),
    ("favicon.png", 48, scaled(0.86), "", True),
]
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, size, body, bg, transparent in JOBS:
        pg = b.new_page(viewport={"width": size, "height": size})
        pg.set_content(page(size, body, "transparent" if transparent else bg))
        pg.screenshot(path=str(ASSETS / name), omit_background=transparent)
        pg.close()
        print("wrote", name)
    b.close()
