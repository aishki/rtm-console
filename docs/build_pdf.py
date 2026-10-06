"""Build docs/RTM_Console_Simulation_Guide.pdf from docs/src/simulation-guide.html.

    python docs/build_pdf.py

Needs Chrome or Edge (set CHROME to its path if it is not found) and `pip install pypdf`.
The page is printed twice: once to find out which page each section lands on, and again with
those numbers filled into the contents list on the cover.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from pypdf import PdfReader

DOCS = Path(__file__).resolve().parent
SOURCE = DOCS / "src" / "simulation-guide.html"
OUTPUT = DOCS / "RTM_Console_Simulation_Guide.pdf"

BROWSERS = [
    os.environ.get("CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]


def browser() -> str:
    for path in BROWSERS:
        if path and Path(path).exists():
            return path
    sys.exit("Chrome or Edge was not found. Set the CHROME environment variable to its path.")


def print_pdf(html: str, out: Path) -> None:
    tmp = Path(tempfile.mkdtemp(prefix="rtm-guide-"))
    try:
        page, pdf = tmp / "guide.html", tmp / "guide.pdf"
        page.write_text(html, encoding="utf-8")
        subprocess.run(
            [browser(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--user-data-dir={tmp / 'profile'}",
             f"--print-to-pdf={pdf}", page.as_uri()],
            check=True, capture_output=True, timeout=120,
        )
        # On Windows the launcher returns before the browser has written the file.
        deadline, size = time.time() + 60, -1
        while time.time() < deadline:
            now = pdf.stat().st_size if pdf.exists() else -1
            if now > 0 and now == size:
                break
            size = now
            time.sleep(0.5)
        else:
            sys.exit("The browser did not produce a PDF.")
        shutil.copyfile(pdf, out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def section_pages(pdf: Path, html: str) -> dict[str, int]:
    """Page number of every numbered section heading, keyed by its number."""
    titles = {n: re.sub(r"<[^>]+>|&\w+;", "", t).strip()
              for n, t in re.findall(r'<h1 class="sec" id="s(\d+)"[^>]*><span class="n">\d+</span>(.*?)</h1>', html)}
    flat = lambda s: re.sub(r"\s+", "", s)
    pages = [flat(p.extract_text() or "") for p in PdfReader(str(pdf)).pages]
    found = {}
    for n, title in titles.items():
        needle = flat(f"{n}{title}")
        # Page 1 is the cover, whose contents list repeats every title.
        found[n] = next((i + 1 for i, text in enumerate(pages) if i > 0 and needle in text), 0)
        if not found[n]:
            sys.exit(f"Could not find section {n} ({title}) in the printed pages.")
    return found


def main() -> None:
    html = SOURCE.read_text(encoding="utf-8")
    fill = lambda pages: re.sub(r"\{\{p(\d+)\}\}", lambda m: str(pages.get(m.group(1), "")), html)
    print_pdf(fill({}), OUTPUT)
    pages = section_pages(OUTPUT, html)
    print_pdf(fill(pages), OUTPUT)
    if section_pages(OUTPUT, html) != pages:
        sys.exit("Section pages moved between passes; run the build again.")
    print(f"{OUTPUT.name}: {len(PdfReader(str(OUTPUT)).pages)} pages, sections on {pages}")


if __name__ == "__main__":
    main()
