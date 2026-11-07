"""Screen indexed English Madara sites for a reachable public catalog."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen
import zipfile


INDEX = "https://codeload.github.com/keiyoushi/extensions-source/zip/refs/heads/main"
MARKERS = re.compile(r"wp-manga|madara-core|wp-content/themes/madara|c-tabs-item__content", re.I)
SERIES = re.compile(r"/(?:manga|manhwa|manhua|series|comic)/[^/]+/?$", re.I)
LINKS = re.compile(r"<a\b[^>]*\bhref\s*=\s*([\"'])(.*?)\1", re.I)


def domain(url):
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


class SameSiteRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, new_url):
        target = urlsplit(new_url)
        if (target.scheme != "https" or target.port not in (None, 443)
                or target.username is not None or domain(new_url) != domain(request.full_url)):
            raise HTTPError(request.full_url, code, "Redirect to another host or insecure URL", headers, fp)
        return super().redirect_request(request, fp, code, msg, headers, new_url)


def discover():
    with urlopen(INDEX, timeout=30) as response:
        archive = response.read(256 * 1024 * 1024 + 1)
    if len(archive) > 256 * 1024 * 1024:
        raise ValueError("Source index exceeds the archive size limit")
    sites = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as index:
        for path in index.namelist():
            if not re.search(r"/src/en/[^/]+/build\.gradle\.kts$", path):
                continue
            fields = dict(re.findall(r'(theme|baseUrl)\s*=\s*"([^"]+)"', index.read(path).decode()))
            base = fields.get("baseUrl", "")
            if fields.get("theme") == "madara" and base.startswith("https://"):
                sites.setdefault(domain(base), {"id": path.split("/")[-2], "baseUrl": base})
    return list(sites.values())


def check(site, timeout):
    opener = build_opener(SameSiteRedirect())
    found = set()
    madara = False
    error = None
    reached = False
    for url in (site["baseUrl"], urljoin(site["baseUrl"], "/manga/")):
        try:
            request = Request(url, headers={"User-Agent": "JellyManga/0.1 (+https://jellyfin.org)"})
            with opener.open(request, timeout=timeout) as response:
                page = response.read(1024 * 1024).decode("utf-8", errors="replace")
                effective_url = response.url
            reached = True
            madara |= bool(MARKERS.search(page))
            for _, href in LINKS.findall(page):
                link = urlsplit(urljoin(effective_url, href))
                if domain(link.geturl()) == domain(effective_url) and SERIES.fullmatch(link.path):
                    found.add(link.path.rstrip("/"))
            if madara and found:
                return dict(site, result="pass", seriesLinks=len(found))
        except (ValueError, OSError) as exc:
            error = str(exc)
    return dict(site, result="review" if reached else "failed", seriesLinks=len(found), error=error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--timeout", type=float, default=8)
    parser.add_argument("--output", type=Path, default=Path("artifacts/madara-site-check.json"))
    args = parser.parse_args()
    if not 1 <= args.workers <= 24 or not 1 <= args.timeout <= 60:
        parser.error("Use 1–24 workers and a timeout of 1–60 seconds.")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda site: check(site, args.timeout), discover()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"Checked {len(results)} unique domains. {dict(Counter(row['result'] for row in results))}")
    print(args.output)


if __name__ == "__main__":
    main()
