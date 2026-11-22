#!/usr/bin/env python3
"""
Discovery step #2: official websites via public d.co.il (Dapei Zahav) category/city pages.
robots.txt is checked for every URL. Only the business's website URL is taken; emails
are collected later by crawler.py from the business's own site.
Appends to data/seeds.csv (skipping domains already present).
"""
import csv, re, time, sys
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
from urllib import robotparser
from pathlib import Path
import requests
from bs4 import BeautifulSoup

BASE = Path(__file__).resolve().parent
SEEDS = BASE / "data" / "seeds.csv"
UA = "Mozilla/5.0 (compatible; BrakhaLeadFinder/1.0; business-contact research)"
H = {"User-Agent": UA}
MAX_PAGES = int(sys.argv[1]) if len(sys.argv) > 1 else 5

CATS = {"630": "אדריכלים", "570": "מעצבי פנים", "33820": "ניהול נכסים",
        "2295": "חברות אחזקה", "תיווך": "משרדי תיווך", "7400": "מוסדות", "10880": "מוסדות"}
CACHE = BASE / "data" / "dcoil_seen_ids.txt"
CITIES = {"5000": "תל אביב", "8600": "רמת גן", "6300": "גבעתיים", "6600": "חולון",
          "6200": "בת ים", "2620": "קריית אונו", "7900": "פתח תקווה"}
NOT_OFFICIAL = ("d.co.il", "zapgroup", "zap.co.il", "facebook", "instagram", "google", "waze",
                "youtube", "linkedin", "tiktok", "twitter", "pinterest", "wa.me", "whatsapp",
                "apple.com", "b144", "yad2", "madlan", "houzz", "midrag", "x.com", "t.me",
                "linktr.ee", "bit.ly", "duns100", "wikipedia", "easy.co.il", "bezeq")

rp = robotparser.RobotFileParser()
rp.parse(requests.get("https://www.d.co.il/robots.txt", headers=H, timeout=20).text.splitlines())


def get(url):
    if not rp.can_fetch(UA, url):
        return None
    for _ in range(2):
        try:
            r = requests.get(url, headers=H, timeout=25)
            if r.status_code == 200:
                return r.text
            if r.status_code in (403, 429):
                print("blocked", r.status_code, url); return None
            return None
        except Exception:
            time.sleep(2)
    return None


def biz_page(item):
    bid, cat_code, cat, city = item
    time.sleep(0.8)
    u = f"https://www.d.co.il/{bid}/{cat_code}/" if cat_code.isdigit() else f"https://www.d.co.il/{bid}/"
    t = get(u)
    if not t:
        return None
    s = BeautifulSoup(t, "html.parser")
    title = s.title.get_text(" ", strip=True) if s.title else ""
    name = title.split(",")[0].strip().strip('"')
    sites = [a["href"].strip() for a in s.find_all("a", href=True)
             if a["href"].startswith("http") and not any(x in a["href"].lower() for x in NOT_OFFICIAL)]
    in_city = any(w in title for w in {"תל אביב": ["תל אביב", "יפו"], "רמת גן": ["רמת גן"],
                                       "גבעתיים": ["גבעתיים"], "חולון": ["חולון"], "בת ים": ["בת ים"],
                                       "קריית אונו": ["קרית אונו", "קריית אונו"],
                                       "פתח תקווה": ["פתח תקווה", "פתח תקוה"]}[city])
    return {"url": sites[0] if sites else "", "name": name, "category": cat, "city": city,
            "directory_page": u, "in_city": in_city}


def main():
    import os
    only_c = os.environ.get("ONLY_CATS", "").split(",") if os.environ.get("ONLY_CATS") else None
    only_city = os.environ.get("ONLY_CITIES", "").split(",") if os.environ.get("ONLY_CITIES") else None
    cats = {k: v for k, v in CATS.items() if not only_c or k in only_c}
    cities = {k: v for k, v in CITIES.items() if not only_city or k in only_city}
    items = {}
    for code, cat in cats.items():
        for ccode, city in cities.items():
            seen_pages, queue = set(), [f"https://www.d.co.il/h-c{code}-e0-p0-l0-city{ccode}/"]
            while queue and len(seen_pages) < MAX_PAGES:
                pu = queue.pop(0)
                if pu in seen_pages:
                    continue
                seen_pages.add(pu)
                t = get(pu)
                time.sleep(0.8)
                if not t:
                    continue
                ids = re.findall(r'href="(?:https://www\.d\.co\.il)?/(\d{6,})/(\d*)/?"', t)
                for bid, c in ids:
                    items.setdefault(bid, (bid, c or code, cat, city))
                for p in sorted({int(x) for x in re.findall(rf"-p(\d+)-l0-city{ccode}", t)}):
                    nu = f"https://www.d.co.il/h-c{code}-e0-p{p}-l0-city{ccode}/"
                    if nu not in seen_pages and nu not in queue:
                        queue.append(nu)
            print(f"{cat}/{city}: pages={len(seen_pages)} total_biz={len(items)}", flush=True)

    existing, rows = set(), []
    with open(SEEDS, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append(r)
            existing.add(urlparse(r["url"] if r["url"].startswith("http") else "https://" + r["url"]).netloc.lower().replace("www.", ""))
    done_ids = set(CACHE.read_text().split()) if CACHE.exists() else set()
    for r in rows:
        m = re.search(r"d\.co\.il/(\d{6,})/", r.get("directory_page") or "")
        if m:
            done_ids.add(m.group(1))
    todo = [v for k, v in items.items() if k not in done_ids]
    print(f"business cards to read: {len(todo)} (cached {len(items) - len(todo)})", flush=True)
    FIELDS = ["url", "category", "city", "name", "directory_page"]

    def flush():
        with open(SEEDS, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in FIELDS})
        CACHE.write_text("\n".join(sorted(done_ids)))

    from concurrent.futures import as_completed
    added = nosite = outside = n = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(biz_page, it): it for it in todo}
        for fu in as_completed(futs):
            n += 1
            done_ids.add(futs[fu][0])
            r = fu.result()
            if r:
                if not r["url"]:
                    nosite += 1
                elif not r.pop("in_city"):
                    outside += 1
                else:
                    d = urlparse(r["url"]).netloc.lower().replace("www.", "")
                    if d and d not in existing:
                        existing.add(d); rows.append(r); added += 1
            if n % 50 == 0:
                flush()
                print(f"  cards {n}/{len(todo)} added={added}", flush=True)
    flush()
    print(f"biz_pages={len(items)} added={added} no_website={nosite} outside_area={outside} seeds_total={len(rows)}")


if __name__ == "__main__":
    main()
