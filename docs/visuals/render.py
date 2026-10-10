"""Render docs/visuals/*.html -> docs/images/*.png at 2x with Playwright (Chromium).

    python docs/visuals/render.py            # all
    python docs/visuals/render.py results    # just results.html
Each page draws into a #frame element; that element is screenshotted.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "images"
OUT.mkdir(exist_ok=True)

names = sys.argv[1:] or sorted(p.stem for p in HERE.glob("*.html") if not p.stem.startswith("_"))

with sync_playwright() as pw:
    try:
        browser = pw.chromium.launch()
    except Exception:
        # fall back to any already-downloaded headless shell (avoids a re-download on version skew)
        shells = sorted(Path.home().glob("AppData/Local/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell*"))
        if not shells:
            raise
        browser = pw.chromium.launch(executable_path=str(shells[-1]))
    ctx = browser.new_context(viewport={"width": 1200, "height": 1000}, device_scale_factor=2)
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("  PAGE ERROR:", e))
    page.on("console", lambda m: m.type in ("error", "warning") and print("  console:", m.text))
    for name in names:
        page.goto((HERE / f"{name}.html").as_uri(), wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(250)
        frame = page.locator("#frame")
        box = frame.bounding_box()
        out = OUT / f"{name}.png"
        frame.screenshot(path=str(out), animations="disabled")
        print(f"{out.name}: {int(box['width'])}x{int(box['height'])} css px -> {int(box['width']*2)}x{int(box['height']*2)}")
    browser.close()
