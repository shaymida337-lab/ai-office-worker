#!/usr/bin/env python3
"""
Business lead finder: collects PUBLIC business contact emails from official websites.

Rules enforced in code:
  * robots.txt is respected (pages disallowed for our user-agent are skipped).
  * No protection bypass: no captcha solving, no login, no Cloudflare email-obfuscation
    decoding, sites that answer 401/403/429 are skipped.
  * Only a few pages per site (home + contact/about pages), polite delay per site.
  * Only addresses published on the business's own site are kept; obvious
    non-contact addresses (noreply, developer/platform addresses, image names) are dropped.
  * Every email is verified: syntax + domain has MX (or A) records via DNS-over-HTTPS
    + the address literally appears on the source page (URL stored).
  * De-duplicated globally and checked against data/blocklist.csv and
    data/previous_contacts.csv.
  * Progress saved every 25 businesses (state JSON + Excel).

Usage: python3 crawler.py [--target 200] [--workers 8]
"""
import argparse, csv, json, re, sys, time, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib import robotparser

import requests
from bs4 import BeautifulSoup
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
OUT = BASE / "output"
OUT.mkdir(exist_ok=True)
STATE_FILE = OUT / "state.json"
XLSX_FILE = OUT / "business_leads.xlsx"

UA = "Mozilla/5.0 (compatible; BrakhaLeadFinder/1.0; business-contact research)"
TIMEOUT = 15
MAX_PAGES = 6
PER_SITE_DELAY = 0.7

CITIES = {
    "תל אביב": ["תל אביב", "תל-אביב", "tel aviv", "tel-aviv", "יפו"],
    "רמת גן": ["רמת גן", "רמת-גן", "ramat gan", "ramat-gan", "בורסה"],
    "גבעתיים": ["גבעתיים", "givatayim", "givataim"],
    "חולון": ["חולון", "holon"],
    "בת ים": ["בת ים", "בת-ים", "bat yam", "bat-yam"],
    "קריית אונו": ["קריית אונו", "קרית אונו", "kiryat ono", "kiryat-ono"],
    "פתח תקווה": ["פתח תקווה", "פתח תקוה", "פ\"ת", "petah tikva", "petach tikva", "petah tiqva"],
}

# Directories / social / marketplaces: not an official business website
SKIP_DOMAINS = {
    "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com",
    "tiktok.com", "wikipedia.org", "d.co.il", "b144.co.il", "easy.co.il", "zap.co.il",
    "madlan.co.il", "yad2.co.il", "google.com", "waze.com", "houzz.com", "houzz.co.il",
    "midrag.co.il", "dun.co.il", "duns100.co.il", "bizportal.co.il", "checkid.co.il",
    "winwin.co.il", "homeless.co.il", "pinterest.com", "behance.net", "yelp.com",
    "tripadvisor.com", "ynet.co.il", "calcalist.co.il", "themarker.com", "globes.co.il",
    "mako.co.il", "walla.co.il", "haaretz.co.il", "bing.com", "duckduckgo.com",
    "rest.co.il", "2all.co.il", "cylex-israel.co.il", "find-us-here.com", "israelbiz.co.il",
}

FREE_PROVIDERS = {"gmail.com", "walla.co.il", "walla.com", "hotmail.com", "outlook.com",
                  "yahoo.com", "012.net.il", "013.net", "bezeqint.net", "netvision.net.il",
                  "zahav.net.il", "smile.net.il", "live.com", "icloud.com", "inter.net.il",
                  "gmail.co.il", "013net.net", "actcom.co.il", "barak.net.il"}

BAD_EMAIL_PARTS = ("noreply", "no-reply", "donotreply", "example.", "sentry", "wixpress",
                   "@sentry", "domain.com", "email.com", "yourdomain", "test@", "user@",
                   "name@", "@mail.com", "privacy@wix", "@wix.com", "@godaddy", "@elementor",
                   "@cloudflare", "@w3.org", "@schema.org", "@jquery", "abuse@", "postmaster@",
                   "webmaster@", "hostmaster@", "@sentry.io", "@ingest.", "@2x", "@3x")
BAD_TLDS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js", ".ico", ".mp4", ".pdf")

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}")
STRICT_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._%+\-]{0,62}[A-Za-z0-9])?@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$")
CONTACT_HINTS = ("contact", "צור-קשר", "צור קשר", "צרו קשר", "צרו-קשר", "about", "אודות",
                 "%d7%a6%d7%95%d7%a8", "%d7%a6%d7%a8%d7%95", "%d7%90%d7%95%d7%93%d7%95%d7%aa",
                 "team", "צוות", "office", "משרד")
FALLBACK_PATHS = ("/contact", "/contact-us", "/צור-קשר", "/about")

_mx_cache = {}
_mx_lock = threading.Lock()


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def reg_domain(host: str) -> str:
    host = (host or "").lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    parts = host.split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in ("wixsite.com", "wordpress.com", "netlify.app",
                                                      "co.il.wixsite.com", "squarespace.com", "webflow.io"):
        return ".".join(parts[-3:])
    if len(parts) >= 3 and parts[-2] in ("co", "org", "net", "ac", "gov", "muni", "k12"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def has_mail_dns(domain: str) -> str:
    """Return 'MX', 'A' (implicit MX) or '' using DNS-over-HTTPS (local DNS is proxied)."""
    with _mx_lock:
        if domain in _mx_cache:
            return _mx_cache[domain]
    result = ""
    for rtype in ("MX", "A"):
        for url in ("https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"):
            try:
                r = requests.get(url, params={"name": domain, "type": rtype},
                                 headers={"accept": "application/dns-json"}, timeout=10)
                j = r.json()
                want = 15 if rtype == "MX" else 1
                if j.get("Status") == 0 and any(a.get("type") == want for a in j.get("Answer", [])):
                    if rtype == "MX":
                        # Null MX ("0 .") means the domain accepts no mail
                        if all(a.get("data", "").strip() in ("0 .", ".") for a in j["Answer"] if a.get("type") == 15):
                            break
                    result = rtype
                break
            except Exception:
                continue
        if result:
            break
    with _mx_lock:
        _mx_cache[domain] = result
    return result


def load_list(path: Path, col: str):
    s = set()
    if path.exists():
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                v = (row.get(col) or "").strip().lower()
                if v:
                    s.add(v)
    return s


class Site:
    def __init__(self, seed):
        self.seed = seed
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": UA, "Accept-Language": "he,en;q=0.8"})
        self.rp = None

    def robots_ok(self, url):
        if self.rp is None:
            p = urlparse(url)
            self.rp = robotparser.RobotFileParser()
            try:
                r = self.session.get(f"{p.scheme}://{p.netloc}/robots.txt", timeout=TIMEOUT)
                if r.status_code in (401, 403):
                    self.rp.disallow_all = True
                elif r.status_code >= 400:
                    self.rp.allow_all = True
                else:
                    self.rp.parse(r.text.splitlines())
            except Exception:
                self.rp.allow_all = True
        try:
            return self.rp.can_fetch(UA, url)
        except Exception:
            return True

    def get(self, url):
        if not self.robots_ok(url):
            return None, "robots-disallow"
        r = None
        for attempt in range(2):
            try:
                r = self.session.get(url, timeout=TIMEOUT, allow_redirects=True)
                break
            except requests.exceptions.ProxyError as e:
                err = "error:ProxyError(site unreachable)"
                time.sleep(2)
            except Exception as e:
                return None, f"error:{type(e).__name__}"
        if r is None:
            return None, err
        if r.status_code in (401, 403, 429, 503):
            return None, f"blocked:{r.status_code}"   # respect protection, do not retry
        if r.status_code >= 400:
            return None, f"http:{r.status_code}"
        ctype = r.headers.get("content-type", "")
        if "html" not in ctype and "text" not in ctype:
            return None, "not-html"
        text = r.text
        low = text.lower()
        if "captcha" in low and len(text) < 20000:
            return None, "captcha"
        return r, "ok"


def clean_email(e: str):
    e = e.strip().strip(".,;:()[]<>\"'").lower()
    e = re.sub(r"^(mailto:|%20|u003e)", "", e)
    if "?" in e:
        e = e.split("?")[0]
    if not STRICT_RE.match(e):
        return None
    if any(b in e for b in BAD_EMAIL_PARTS) or e.endswith(BAD_TLDS):
        return None
    local, dom = e.split("@", 1)
    if len(local) > 40 or re.fullmatch(r"[0-9a-f]{16,}", local):
        return None
    return e


def extract(html: str):
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    for a in soup.select('a[href^="mailto:"], a[href^="MAILTO:"]'):
        raw = a.get("href", "")[7:]
        for part in re.split(r"[,;]", requests.utils.unquote(raw)):
            e = clean_email(part)
            if e:
                found[e] = "mailto"
    for s in soup(["script", "style", "noscript"]):
        s.decompose()
    text = soup.get_text(" ")
    for m in EMAIL_RE.findall(text):
        e = clean_email(m)
        if e and e not in found:
            found[e] = "text"
    return found, soup


def page_title(soup):
    t = soup.title.get_text(" ", strip=True) if soup.title else ""
    og = soup.find("meta", attrs={"property": "og:site_name"})
    if og and og.get("content"):
        return og["content"].strip()
    return re.split(r"\s[|\-–—]\s", t)[0].strip() if t else ""


def detect_city(text: str, fallback: str):
    low = text.lower()
    counts = {c: sum(low.count(v.lower()) for v in vs) for c, vs in CITIES.items()}
    best = max(counts, key=counts.get)
    if fallback in CITIES and counts.get(fallback, 0) > 0:
        return fallback, True
    if counts[best] > 0:
        return best, True
    return fallback, False


def crawl(seed):
    url = seed["url"].strip()
    if not url.startswith("http"):
        url = "https://" + url
    p = urlparse(url)
    host = p.netloc.lower()
    # local DNS is not available for plain http in this sandbox -> always https (most sites support it)
    alt = host[4:] if host.startswith("www.") else "www." + host
    path = p.path if ("wixsite" in host or "wordpress.com" in host) else "/"
    site = Site(seed)
    res = {"seed": seed, "home": f"https://{host}{path}", "domain": reg_domain(host), "emails": {},
           "status": "", "name": seed.get("name", ""), "city": seed.get("city", ""), "city_confirmed": False}
    r, st = None, ""
    for h in (host, alt):
        site.rp = None
        r, st = site.get(f"https://{h}{path}")
        if r is not None:
            res["home"] = f"https://{h}{path}"
            break
        if st.startswith("blocked") or st == "robots-disallow" or st == "captcha":
            break
    if r is None:
        res["status"] = st
        return res
    final_dom = reg_domain(urlparse(r.url).netloc)
    if final_dom in SKIP_DOMAINS:
        res["status"] = "redirect-to-directory"
        return res
    res["domain"] = final_dom
    emails, soup = extract(r.text)
    for e, how in emails.items():
        res["emails"].setdefault(e, (r.url, how))
    alltext = soup.get_text(" ")
    if not res["name"]:
        res["name"] = page_title(soup)
    # candidate contact/about pages from links
    cands = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        label = (a.get_text(" ", strip=True) + " " + href).lower()
        if any(h in label for h in CONTACT_HINTS):
            full = urljoin(r.url, href).split("#")[0]
            if reg_domain(urlparse(full).netloc) == final_dom and full not in cands and full.startswith("http"):
                cands.append(full)
    for fp in FALLBACK_PATHS:
        full = urljoin(r.url, fp)
        if full not in cands:
            cands.append(full)
    visited = {r.url}
    for c in cands:
        if len(visited) >= MAX_PAGES:
            break
        if c in visited:
            continue
        time.sleep(PER_SITE_DELAY)
        r2, st2 = site.get(c)
        visited.add(c)
        if r2 is None:
            if st2.startswith("blocked") or st2 == "captcha":
                break
            continue
        em2, soup2 = extract(r2.text)
        alltext += " " + soup2.get_text(" ")
        for e, how in em2.items():
            res["emails"].setdefault(e, (r2.url, how))
    res["city"], res["city_confirmed"] = detect_city(alltext, seed.get("city", ""))
    res["status"] = "ok" if res["emails"] else "no-email"
    return res


ROLE_LOCALS = {"info", "office", "contact", "mail", "hello", "studio", "sales", "service", "admin",
               "management", "nihul", "shirut", "support", "contactus", "contact-us", "office1",
               "secretary", "mazkirut", "pniot", "inquiries", "enquiries", "design", "architects",
               "arch", "home", "main", "general", "reception", "realestate", "nadlan", "tivuch",
               "projects", "project", "team", "service-center", "customer", "customers", "lead",
               "leads", "business", "biz", "marketing", "orders", "office.manager", "bureau",
               "hr", "jobs", "career", "careers", "accounts", "billing", "finance", "media", "press"}
TEAM_HINTS = ("team", "צוות", "%d7%a6%d7%95%d7%95%d7%aa", "staff", "people", "our-team", "אנשים")


NOT_FOR_INQUIRIES = {"hr", "jobs", "job", "career", "careers", "cv", "drushim", "resume", "privacy",
                     "accessibility", "negishut", "dpo", "legal", "unsubscribe"}
LOW_PRIORITY = {"finance", "accounts", "billing", "hashbonot", "invoices", "accounting", "media", "press"}


def is_role(email):
    local, dom = email.split("@")
    label = reg_domain(dom).split(".")[0]
    return (local in ROLE_LOCALS or local == label or
            any(local.startswith(r) for r in ("info", "office", "contact")))


def rank_email(email, site_domain):
    local, dom = email.split("@")
    score = 0
    if reg_domain(dom) == site_domain:
        score += 10
    elif dom in FREE_PROVIDERS:
        score += 3
    if local.startswith(("info", "office", "contact")) or local in ("mail", "hello", "studio", "sales",
                                                                    "service", "management", "nihul"):
        score += 6
    elif local == reg_domain(dom).split(".")[0]:
        score += 5
    elif local in LOW_PRIORITY:
        score += 1
    elif is_role(email):
        score += 3
    return score


def save(state):
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    wb = Workbook()
    ws = wb.active
    ws.title = "לידים מאומתים"
    ws.sheet_view.rightToLeft = True
    hdr = ["#", "שם העסק", "עיר", "תחום", "אתר", "מייל", "מקור (עמוד שבו פורסם המייל)",
           "סוג כתובת", "אימות DNS", "עיר אומתה באתר", "תאריך איסוף"]
    ws.append(hdr)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4E78")
        c.alignment = Alignment(horizontal="center")
    for i, L in enumerate(state["leads"], 1):
        ws.append([i, L["name"], L["city"], L["category"], L["website"], L["email"], L["source"],
                   L["email_type"], L["dns"], "כן" if L["city_confirmed"] else "לפי חיפוש",
                   L["collected"]])
    widths = [5, 32, 12, 18, 34, 34, 55, 14, 10, 14, 18]
    for col, w in zip("ABCDEFGHIJK", widths):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A2"
    ws2 = wb.create_sheet("הוחרגו")
    ws2.sheet_view.rightToLeft = True
    ws2.append(["מייל / אתר", "סיבה", "מקור"])
    for x in state["excluded"]:
        ws2.append([x["item"], x["reason"], x.get("source", "")])
    ws3 = wb.create_sheet("אתרים שנסרקו")
    ws3.sheet_view.rightToLeft = True
    ws3.append(["אתר", "תחום", "עיר", "סטטוס", "מיילים שנמצאו"])
    for s in state["sites"]:
        ws3.append([s["url"], s["category"], s["city"], s["status"], s["n"]])
    ws4 = wb.create_sheet("סיכום")
    ws4.sheet_view.rightToLeft = True
    from collections import Counter
    ws4.append(["מדד", "ערך"])
    ws4.append(["מיילים מאומתים", len(state["leads"])])
    ws4.append(["עסקים עם מייל", len({l["website"] for l in state["leads"]})])
    ws4.append(["אתרים שנסרקו", len(state["sites"])])
    ws4.append(["עודכן", datetime.now().strftime("%Y-%m-%d %H:%M")])
    ws4.append([])
    ws4.append(["לפי תחום", ""])
    for k, v in Counter(l["category"] for l in state["leads"]).most_common():
        ws4.append([k, v])
    ws4.append([])
    ws4.append(["לפי עיר", ""])
    for k, v in Counter(l["city"] for l in state["leads"]).most_common():
        ws4.append([k, v])
    wb.save(XLSX_FILE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=200)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--max-per-business", type=int, default=2)  # 2nd address only if it is a general/role address
    args = ap.parse_args()

    blocked = load_list(DATA / "blocklist.csv", "email_or_domain")
    previous = load_list(DATA / "previous_contacts.csv", "email")

    state = {"leads": [], "excluded": [], "sites": [], "done_urls": []}
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    seen_emails = {l["email"] for l in state["leads"]}
    seen_domains = {reg_domain(urlparse(s["url"] if s["url"].startswith("http") else "https://" + s["url"]).netloc)
                    for s in state["sites"]}
    done = set(state["done_urls"])

    seeds, seed_domains = [], set()
    with open(DATA / "seeds.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            u = (row.get("url") or "").strip()
            if not u:
                continue
            d = reg_domain(urlparse(u if u.startswith("http") else "https://" + u).netloc)
            if d in SKIP_DOMAINS or d in seed_domains or d in seen_domains or u in done:
                continue
            seed_domains.add(d)
            seeds.append(row)
    log(f"seeds to crawl: {len(seeds)} | existing leads: {len(state['leads'])}")

    lock = threading.Lock()
    processed = 0
    stop = threading.Event()

    def handle(res):
        nonlocal processed
        seed = res["seed"]
        added = 0
        site_dom = res["domain"]
        ranked = sorted(res["emails"].items(),
                        key=lambda kv: (-rank_email(kv[0], site_dom),
                                        any(h in kv[1][0].lower() for h in TEAM_HINTS)))
        has_role = any(is_role(e) for e in res["emails"])
        for email, (src, how) in ranked:
            dom = email.split("@")[1]
            reason = None
            if email in seen_emails:
                reason = "כפילות"
            elif email in blocked or dom in blocked or reg_domain(dom) in blocked:
                reason = "ברשימת חסימה"
            elif email in previous:
                reason = "כבר פנינו בעבר"
            elif reg_domain(dom) != site_dom and dom not in FREE_PROVIDERS:
                reason = "דומיין זר (לא של העסק)"
            elif added >= args.max_per_business:
                reason = "מעבר למכסה לעסק"
            elif not is_role(email) and (has_role or added > 0):
                reason = "כתובת אישית של עובד (יש כתובת כללית / כבר נבחרה כתובת)"
            elif not is_role(email) and any(h in src.lower() for h in TEAM_HINTS):
                reason = "כתובת אישית מעמוד צוות"
            if not reason and added >= 1 and email.split("@")[0] in LOW_PRIORITY:
                reason = "כתובת כספים/הנה\"ח — יש כבר כתובת ראשית"
            if not reason and email.split("@")[0] in NOT_FOR_INQUIRIES:
                reason = "כתובת שאינה מיועדת לפניות עסקיות (גיוס/פרטיות)"
            if reason:
                state["excluded"].append({"item": email, "reason": reason, "source": src})
                continue
            dns_ok = has_mail_dns(dom)
            if not dns_ok:
                state["excluded"].append({"item": email, "reason": "אין רשומת MX/A לדומיין", "source": src})
                continue
            seen_emails.add(email)
            added += 1
            state["leads"].append({
                "name": res["name"] or site_dom, "city": res["city"], "category": seed.get("category", ""),
                "website": res["home"], "email": email, "source": src,
                "email_type": ("כללית" if is_role(email) else "ראשית של העסק") + " / " +
                              ("דומיין העסק" if reg_domain(dom) == site_dom else "ספק חינמי"),
                "dns": dns_ok, "city_confirmed": res["city_confirmed"],
                "collected": datetime.now().strftime("%Y-%m-%d %H:%M"),
            })
        state["sites"].append({"url": seed["url"], "category": seed.get("category", ""),
                               "city": res["city"], "status": res["status"], "n": added})
        state["done_urls"].append(seed["url"])
        processed += 1
        log(f"[{processed}/{len(seeds)}] {res['domain']:<35} {res['status']:<18} +{added}  total={len(state['leads'])}")
        if processed % 25 == 0:
            save(state)
            log(f"--- checkpoint saved ({len(state['leads'])} leads) ---")
        if len(state["leads"]) >= args.target:
            stop.set()

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {}
        it = iter(seeds)
        for s in it:
            futs[ex.submit(crawl, s)] = s
            if len(futs) >= args.workers * 2:
                break
        while futs:
            for fu in as_completed(list(futs)):
                s = futs.pop(fu)
                try:
                    res = fu.result()
                except Exception as e:
                    res = {"seed": s, "home": s["url"], "domain": "", "emails": {}, "status": f"crash:{e}",
                           "name": s.get("name", ""), "city": s.get("city", ""), "city_confirmed": False}
                with lock:
                    handle(res)
                if not stop.is_set():
                    nxt = next(it, None)
                    if nxt:
                        futs[ex.submit(crawl, nxt)] = nxt
                break
    save(state)
    log(f"DONE. verified leads: {len(state['leads'])}  -> {XLSX_FILE}")


if __name__ == "__main__":
    main()
