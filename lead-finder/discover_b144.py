#!/usr/bin/env python3
"""
Discovery step: find OFFICIAL websites of businesses via the public B144 category/city
listing pages (allowed by b144 robots.txt). Emails are NOT taken from B144 —
only the business's own website URL, which crawler.py then visits.
Output: data/seeds.csv (url, category, city, name, directory_page)
"""
import csv, re, time, sys
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
from urllib import robotparser
import requests
from bs4 import BeautifulSoup
from pathlib import Path

BASE = Path(__file__).resolve().parent
SEEDS = BASE / "data" / "seeds.csv"
UA = "Mozilla/5.0 (compatible; BrakhaLeadFinder/1.0; business-contact research)"
H = {"User-Agent": UA}

CATEGORIES = {   # b144 slug -> category label (Hebrew)
    "אדריכלים": "אדריכלים",
    "אדריכלות": "אדריכלים",
    "אדריכלות-נוף": "אדריכלים",
    "עיצוב-פנים": "מעצבי פנים",
    "ניהול-נכסים": "ניהול נכסים",
    "ועד-בית": "ניהול נכסים",
    "ניהול-בתים-משותפים": "ניהול נכסים",
    "אחזקת-מבנים": "חברות אחזקה",
    "חברות-ניקיון-ואחזקה": "חברות אחזקה",
    "תיווך-נדלן": "משרדי תיווך",
    "מתווכים": "משרדי תיווך",
    "בתי-אבות": "מוסדות",
    "מוסדות-חינוך": "מוסדות",
    "מתנסים": "מוסדות",
}
CITIES = {
    "תל-אביב-יפו": "תל אביב", "רמת-גן": "רמת גן", "גבעתיים": "גבעתיים", "חולון": "חולון",
    "בת-ים": "בת ים", "קריית-אונו": "קריית אונו", "פתח-תקווה": "פתח תקווה",
}
CITY_WORDS = {"תל אביב": ["תל אביב"], "רמת גן": ["רמת גן"], "גבעתיים": ["גבעתיים"],
              "חולון": ["חולון"], "בת ים": ["בת ים"], "קריית אונו": ["קריית אונו", "קרית אונו"],
              "פתח תקווה": ["פתח תקווה", "פתח תקוה"]}
NOT_OFFICIAL = ("b144", "bezeq", "facebook", "instagram", "google", "waze", "youtube", "linkedin",
                "tiktok", "twitter", "pinterest", "wa.me", "whatsapp", "apple.com", "archifind",
                "yad2", "madlan", "d.co.il", "houzz", "midrag", "x.com", "t.me", "booking", "easy.co.il",
                "linktr.ee", "play.google", "zap.co.il", "bit.ly", "duns100", "wikipedia")

rp = robotparser.RobotFileParser()
rp.parse(requests.get("https://www.b144.co.il/robots.txt", headers=H, timeout=20).text.splitlines())


def get(url):
    if not rp.can_fetch(UA, url):
        return None
    for _ in range(2):
        try:
            r = requests.get(url, headers=H, timeout=25)
            if r.status_code == 200:
                return r.text
            if r.status_code in (403, 429):
                return None
        except Exception:
            time.sleep(2)
    return None


def parse_sip(url):
    time.sleep(0.8)
    t = get(url)
    if not t:
        return None
    s = BeautifulSoup(t, "html.parser")
    title = s.title.get_text(" ", strip=True) if s.title else ""
    name = title.split(" - ")[0].strip()
    sites = []
    for a in s.find_all("a", href=True):
        h = a["href"].strip()
        if h.startswith("http") and not any(x in h.lower() for x in NOT_OFFICIAL):
            sites.append(h)
    city = ""
    for c, ws in CITY_WORDS.items():
        if any(w in title for w in ws):
            city = c
    return {"name": name, "title": title, "site": sites[0] if sites else "", "city_from_title": city}


def main():
    sip_meta = {}
    for slug, cat in CATEGORIES.items():
        for cslug, city in CITIES.items():
            u = f"https://www.b144.co.il/{slug}/{cslug}/"
            t = get(u)
            time.sleep(0.8)
            if not t:
                print("skip", u); continue
            sips = list(dict.fromkeys(re.findall(r"https://www\.b144\.co\.il/b144_sip/[0-9A-F]+/", t)))
            for sp in sips:
                sip_meta.setdefault(sp, (cat, city, u))
            print(f"{slug}/{cslug}: {len(sips)}  (total {len(sip_meta)})", flush=True)

    rows, seen = [], set()
    if SEEDS.exists():
        with open(SEEDS, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rows.append(r); seen.add(urlparse(r["url"]).netloc.lower().replace("www.", ""))
    items = list(sip_meta.items())
    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(lambda kv: (kv, parse_sip(kv[0])), items))
    kept = off_area = nosite = 0
    for (sp, (cat, city, listing)), info in results:
        if not info:
            continue
        if not info["site"]:
            nosite += 1; continue
        # keep only businesses whose B144 card is in a target city
        if info["city_from_title"] and info["city_from_title"] != city:
            if info["city_from_title"] in CITY_WORDS:
                city = info["city_from_title"]
        elif not info["city_from_title"]:
            off_area += 1; continue
        dom = urlparse(info["site"]).netloc.lower().replace("www.", "")
        if not dom or dom in seen:
            continue
        seen.add(dom)
        rows.append({"url": info["site"], "category": cat, "city": city, "name": info["name"],
                     "directory_page": sp})
        kept += 1
    with open(SEEDS, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["url", "category", "city", "name", "directory_page"])
        w.writeheader(); w.writerows(rows)
    print(f"cards={len(items)} kept={kept} no_website={nosite} outside_area={off_area} seeds_total={len(rows)}")


if __name__ == "__main__":
    main()
