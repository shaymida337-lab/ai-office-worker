# Deployment Guide — עובד משרד AI (AI Office Worker)

A complete, step-by-step manual written for a **non-technical founder**. Follow it top to bottom the first time. You do **not** need to know how to code — every step is click-by-click. Set aside about 1–2 hours for the first deploy.

> **What you're deploying:** a "static" website — a folder of ready-made files (HTML, CSS, images). There is no database and no server to manage, which makes hosting fast, cheap (often free), and very reliable.

---

## Table of contents

1. [Folder structure](#1-folder-structure)
2. [All files organized correctly](#2-all-files-organized-correctly)
3. [How to run the site locally](#3-how-to-run-the-site-locally)
4. [How to deploy to Vercel](#4-how-to-deploy-to-vercel-recommended)
5. [How to deploy to Render](#5-how-to-deploy-to-render-alternative)
6. [How to connect ai-office-worker.com from Namecheap](#6-how-to-connect-ai-office-workercom-from-namecheap)
7. [SEO optimization](#7-seo-optimization)
8. [Google Analytics setup](#8-google-analytics-setup-ga4)
9. [Mobile optimization checklist](#9-mobile-optimization-checklist)
10. [Production deployment checklist](#10-production-deployment-checklist)
11. [Glossary](#glossary-plain-english)

---

## 1. Folder structure

Everything lives inside one folder named `ai-office-worker`. Here is what's inside it:

```
ai-office-worker/
│
├── index.html              ← Home page (this is the front door)
├── features.html           ← Features page
├── about.html              ← About page
├── contact.html            ← Contact page
├── security.html           ← Security page
├── privacy.html            ← Privacy Policy
├── terms.html              ← Terms of Service
│
├── assets/
│   ├── styles.css          ← All the visual design / styling
│   └── script.js           ← The interactivity (menus, forms, animations)
│
├── robots.txt              ← Tells Google it may index the site (SEO)
├── sitemap.xml             ← A map of all pages for Google (SEO)
│
│   ── Favicon files (the little icon in the browser tab) ──
├── favicon.ico
├── favicon.svg
├── favicon-16.png
├── favicon-32.png
├── apple-touch-icon.png
├── android-chrome-192.png
├── android-chrome-512.png
├── site.webmanifest
│
└── brand/                  ← Your logo & brand kit (NOT needed by the live site)
    ├── logo-concept.html   ← The brand guide you can open in a browser
    ├── logo-mark.svg
    ├── logo-horizontal-rtl.svg
    ├── logo-stacked.svg
    ├── logo-mark-white.svg
    ├── logo-mark-mono.svg
    ├── make_favicons.py
    └── favicons/           ← Master copies of all favicon files
```

**Two things worth understanding:**

- The favicon files appear **twice** on purpose — once in the site root (so the live website can find them at addresses like `/favicon.ico`) and once inside `brand/favicons/` (the master copies / brand kit). Keep both.
- The **`brand/` folder is your design kit**, not part of the website visitors see. You can leave it in (harmless) or delete it before deploying to keep things tidy. It will not affect the live site either way.

---

## 2. All files organized correctly

Before deploying, do this **one important edit** so every page shows the logo icon and is ready for analytics and SEO.

### 2a. Add the favicon tags to every page (5 minutes)

Open `brand/favicons/head-snippet.html` — it contains a small block of code. You need to paste that block into the `<head>` section of **each of the 7 pages**. The `<head>` is near the very top of each HTML file.

Look for the line in each page that currently says something like:

```html
<link rel="stylesheet" href="assets/styles.css" />
```

Paste the favicon block **just above** that line. Repeat for all 7 pages: `index.html`, `features.html`, `about.html`, `contact.html`, `security.html`, `privacy.html`, `terms.html`.

> Tip: You can edit these files in a free editor like **VS Code** (code.visualstudio.com). Use **Find & Replace across files** to paste the block everywhere at once if you're comfortable; otherwise do it page by page.

### 2b. Wire up the forms (important!)

Right now the "Join the waiting list" and contact forms **look** like they work but don't actually send the data anywhere yet — they show a success message only. To capture real sign-ups:

1. Create a free form endpoint at **[Formspree](https://formspree.io)** (or any form service). You'll get a URL like `https://formspree.io/f/abcd1234`.
2. Open `assets/script.js`, find the line near the top that reads:
   ```js
   const FORM_ENDPOINT = "";
   ```
3. Put your URL inside the quotes:
   ```js
   const FORM_ENDPOINT = "https://formspree.io/f/abcd1234";
   ```
4. Save. Now submissions are emailed to you.

### 2c. Final check

Make sure the folder is **self-contained** — no files reference anything outside the `ai-office-worker` folder. (It already is; this is just a reminder not to move individual files out.)

---

## 3. How to run the site locally

"Locally" means previewing the site on your own computer before it's public. Two easy ways:

### Option A — Just open it (quickest)
Double-click `index.html`. It opens in your browser. **Caveat:** some features behave slightly differently when opened this way versus on a real web address, so use Option B for an accurate preview.

### Option B — Live Preview in VS Code (recommended)
1. Install **VS Code** (free): code.visualstudio.com
2. Open the `ai-office-worker` folder in VS Code (File → Open Folder).
3. In the Extensions panel (the squares icon on the left), search **"Live Server"** and click Install.
4. Right-click `index.html` → **"Open with Live Server"**.
5. Your browser opens at an address like `http://127.0.0.1:5500` showing the real site. Edits you save appear instantly.

### Option C — One command (if you have Python)
Open a terminal **inside the folder** and run:
```bash
python3 -m http.server 8000
```
Then visit `http://localhost:8000` in your browser. Press `Ctrl + C` in the terminal to stop.

---

## 4. How to deploy to Vercel (recommended)

Vercel is the easiest free host for a site like this, with automatic HTTPS (the padlock) and a global fast network. There are two routes — pick **one**.

### Route 1 — GitHub (best long-term; updates auto-publish)

**Step 1 — Put your code on GitHub**
1. Create a free account at **github.com**.
2. Click **New repository** → name it `ai-office-worker` → keep it Private or Public → **Create repository**.
3. On the next screen choose **"uploading an existing file"**, then drag in **all the contents** of your `ai-office-worker` folder (not the folder itself — its contents, so `index.html` sits at the top). Click **Commit changes**.

**Step 2 — Connect Vercel**
1. Go to **vercel.com** → **Sign Up** → choose **Continue with GitHub**.
2. Click **Add New… → Project**.
3. Find your `ai-office-worker` repository and click **Import**.
4. **Framework Preset:** choose **Other** (this is plain HTML).
5. Leave **Build Command** empty and **Output Directory** empty (or `.`). There's nothing to build.
6. Click **Deploy**.
7. After ~30 seconds you'll get a live link like `ai-office-worker.vercel.app`. 🎉

From now on, every time you upload a change to GitHub, Vercel republishes automatically.

### Route 2 — Vercel CLI (fastest, no GitHub)
1. Install **Node.js** (free): nodejs.org (this gives you the `npm` command).
2. Open a terminal in your folder and run:
   ```bash
   npm i -g vercel
   vercel
   ```
3. Log in when prompted, accept the defaults, and choose your folder. It deploys immediately.
4. To push the final public version later, run `vercel --prod`.

> **HTTPS / SSL:** Vercel turns on the secure padlock automatically. You don't do anything.

---

## 5. How to deploy to Render (alternative)

Render is another solid free option. It deploys from GitHub.

1. Make sure your code is on **GitHub** (see Step 1 above).
2. Go to **render.com** → **Sign up** → connect GitHub.
3. Click **New → Static Site**.
4. Select your `ai-office-worker` repository.
5. Fill in the build settings:
   - **Build Command:** leave **empty** (nothing to build).
   - **Publish Directory:** enter `.` (a single dot — meaning "the whole folder").
6. Click **Create Static Site**. Render builds and gives you a link like `ai-office-worker.onrender.com`.

Render serves your site over a fast global CDN with free HTTPS and automatically redeploys whenever you push changes to GitHub.

> **Which host should I choose?** Either is excellent for this site. **Vercel** is marginally simpler for static sites and has the smoothest custom-domain flow, so this guide treats it as the default. Don't use both for the same live domain — pick one.

---

## 6. How to connect ai-office-worker.com from Namecheap

Once your site is live on Vercel (or Render), point your real domain at it. This happens in two places: your **host** (tell it the domain) and **Namecheap** (tell it where to send visitors).

> ⏳ **Patience note:** DNS changes can take anywhere from a few minutes to 24 hours to take effect worldwide. This is normal.

### Part A — Tell your host about the domain

**On Vercel:** open your project → **Settings → Domains** → type `ai-office-worker.com` → **Add**. Vercel then shows you the **exact DNS records** to create. It will typically ask for:
- An **A record** for the root domain (`@`) pointing to **`76.76.21.21`**
- A **CNAME record** for `www` pointing to a value Vercel shows you (something like `cname.vercel-dns.com` or a unique address ending in `.vercel-dns-XXX.com`)

> Always copy the **exact values shown in your own Vercel dashboard** — the `www` CNAME is unique to your project. The `76.76.21.21` apex IP is Vercel's standard, but if your dashboard shows a different one, use theirs.

**On Render (if you chose Render):** open your static site → **Settings → Custom Domains** → **Add Custom Domain** → enter `ai-office-worker.com` (and add `www.ai-office-worker.com` too). Render shows the records to use — usually a **CNAME** for `www` pointing to your `...onrender.com` address, and for the root domain an **ALIAS** record (see note below).

### Part B — Add the records in Namecheap

1. Log in to **namecheap.com** → **Account → Domain List** → click **Manage** next to `ai-office-worker.com`.
2. Open the **Advanced DNS** tab.
3. **Remove the parking records first.** Namecheap adds default records (often a CNAME on `www` and a "URL Redirect"/`@` record showing a parking page). Delete those so they don't conflict.
4. Click **Add New Record** and enter the records your host gave you. For **Vercel**, that's typically:

   | Type        | Host | Value                          | TTL       |
   |-------------|------|--------------------------------|-----------|
   | A Record    | `@`  | `76.76.21.21`                  | Automatic |
   | CNAME Record| `www`| *(the value Vercel showed you)*| Automatic |

   For **Render**, that's typically:

   | Type           | Host | Value                              | TTL       |
   |----------------|------|------------------------------------|-----------|
   | ALIAS Record   | `@`  | `your-site.onrender.com`           | Automatic |
   | CNAME Record   | `www`| `your-site.onrender.com`           | Automatic |

   > **Why ALIAS for Render's root?** The DNS rules don't allow a plain CNAME on a root/apex domain (`@`). Namecheap offers an **"ALIAS Record"** type that solves this — use it for the root domain when your host gives you a hostname (not an IP). For Vercel you use the A record + IP instead, so this isn't needed there.

5. Click the green checkmark to **save** each record.
6. Go back to your host's domain settings and click **Verify** (Vercel/Render check the records). Once it succeeds, your host automatically issues the free HTTPS certificate.

### Part C — Make sure www and non-www both work
In your **host's** domain settings, set one version as primary and redirect the other (e.g. redirect `www.ai-office-worker.com` → `ai-office-worker.com`, or vice-versa). Vercel and Render both offer a one-click toggle for this. Pick whichever you prefer and be consistent everywhere (ads, business cards, etc.).

### Troubleshooting
- **"Invalid configuration" on the host:** the records haven't propagated yet, or an old parking record is still present. Wait, and double-check you removed Namecheap's defaults.
- **Padlock missing / "not secure":** the SSL certificate is still being issued. It usually appears within minutes of successful verification.
- **Still seeing a Namecheap parking page after a day:** a leftover `@` "URL Redirect Record" is overriding your A/ALIAS record. Delete it in Advanced DNS.

---

## 7. SEO optimization

SEO = helping Google and Hebrew-speaking customers find you. The site already has good foundations (clean code, fast loading, descriptive titles). Here's how to finish the job.

### 7a. Already done for you
- Every page has a unique `<title>` and `<meta name="description">`.
- `robots.txt` and `sitemap.xml` are included (they tell Google what to crawl).
- The site is mobile-friendly and fast — both are ranking factors.

### 7b. Add social-share + canonical tags (recommended)
Paste this into the `<head>` of `index.html` (adjust text per page). This controls how the link looks when shared on WhatsApp/LinkedIn/Facebook and prevents duplicate-content confusion:

```html
<!-- Canonical -->
<link rel="canonical" href="https://ai-office-worker.com/" />

<!-- Open Graph (WhatsApp, Facebook, LinkedIn) -->
<meta property="og:type" content="website" />
<meta property="og:locale" content="he_IL" />
<meta property="og:site_name" content="עובד משרד AI" />
<meta property="og:title" content="עובד משרד AI — עובד המשרד הווירטואלי של העסק שלך" />
<meta property="og:description" content="סריקת מיילים, זיהוי חשבוניות, ניהול משימות, ארגון מסמכים והתראות אוטומטיות במקום אחד." />
<meta property="og:url" content="https://ai-office-worker.com/" />
<meta property="og:image" content="https://ai-office-worker.com/android-chrome-512.png" />

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="עובד משרד AI" />
<meta name="twitter:description" content="העובד הווירטואלי שמנהל מיילים, חשבוניות ומשימות אוטומטית." />
<meta name="twitter:image" content="https://ai-office-worker.com/android-chrome-512.png" />
```

> For a polished share preview, later create a dedicated **1200×630 px** image and point `og:image` at it. The 512px icon works fine to start.

### 7c. Add structured data (helps Google understand your business)
Paste this near the end of `index.html`, just before `</body>`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "עובד משרד AI",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web",
  "description": "עובד משרד וירטואלי מבוסס AI לניהול מיילים, חשבוניות, משימות ומסמכים.",
  "url": "https://ai-office-worker.com/",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "ILS" }
}
</script>
```

### 7d. Submit to Google (the step most people forget)
1. Go to **Google Search Console** (search.google.com/search-console).
2. Add your property → choose **URL prefix** → enter `https://ai-office-worker.com`.
3. Verify ownership (the easiest method is the **HTML tag** — paste the meta tag they give you into your `<head>`, redeploy, then click Verify).
4. In Search Console, go to **Sitemaps** and submit: `sitemap.xml`.
5. (Optional) Repeat for **Bing Webmaster Tools**.

### 7e. Ongoing SEO basics
- Use real, keyword-rich Hebrew copy on each page (your audience searches in Hebrew).
- Give every meaningful image a descriptive `alt` attribute.
- Keep page titles under ~60 characters and descriptions under ~155.
- Earn links: get listed in Israeli startup directories, partner blogs, etc.

---

## 8. Google Analytics setup (GA4)

This tells you how many people visit, where they come from, and which pages they read.

### Step 1 — Create your analytics property
1. Go to **analytics.google.com** and sign in with a Google account.
2. **Admin** (gear icon, bottom-left) → **Create → Property**.
3. Name it `AI Office Worker`, set time zone to Israel and currency to ILS → **Next** → finish the basic questions.

### Step 2 — Create a Web data stream
1. When prompted to choose a platform, pick **Web**.
2. Enter your website URL `https://ai-office-worker.com` and a stream name like `Main website` → **Create stream**.
3. On the stream details screen, copy your **Measurement ID** — it starts with **`G-`** (e.g. `G-XXXXXXXXXX`). This is the key number you need.

### Step 3 — Add the tracking code to your site
On the same screen, open **"View tag instructions" → "Install manually"** to see your Google tag. It looks like the block below. Paste it as the **first thing inside `<head>`** on **every one of your 7 pages**, replacing `G-XXXXXXXXXX` with your real ID:

```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### Step 4 — Deploy and verify
1. Save your files and redeploy (upload to GitHub, or run `vercel --prod`).
2. In Google Analytics, open the **Realtime** report and then visit your live site in another tab. Within a minute you should see yourself counted as **1 active user**. That confirms it works.

> Full reports (visitors per day, traffic sources) can take **24–48 hours** to populate — don't worry if they're empty at first. Realtime is the live proof it's installed correctly.

> **Privacy note:** because you have EU/Israeli visitors, consider adding a simple cookie-consent banner and mention analytics in your Privacy Policy. Free tools like "Cookiebot" or "Osano" can add a banner with one script tag.

---

## 9. Mobile optimization checklist

The site is already responsive (it adapts to phones). Use this list to confirm it shines on mobile before launch.

- [ ] **Viewport tag present** — every page has `<meta name="viewport" content="width=device-width, initial-scale=1.0">`. *(Already included.)*
- [ ] **No sideways scrolling** — on a phone, nothing should bleed off the right/left edge. Check the home page hero and any wide images.
- [ ] **Tap targets are big enough** — buttons and links should be easy to tap with a thumb (about 44×44px minimum). Check the menu and form buttons.
- [ ] **Text is readable without zooming** — body text ~16px+. No tiny print.
- [ ] **The mobile menu works** — tap the ☰ icon; the menu opens and closes; links work.
- [ ] **Forms are easy on mobile** — fields are tall enough, the keyboard doesn't cover the submit button, email fields bring up the email keyboard.
- [ ] **Images aren't huge downloads** — large photos slow phones on mobile data. Keep hero images reasonably sized.
- [ ] **RTL looks correct** — Hebrew content reads right-to-left, alignment and the logo lockup look right on a narrow screen.
- [ ] **Test on a real phone** — open the live `.vercel.app` link on your own phone, not just a desktop browser window.
- [ ] **Run Lighthouse (mobile)** — in Chrome, right-click the page → **Inspect → Lighthouse tab → Mobile → Analyze**. Aim for 90+ on Performance, Accessibility, SEO, Best Practices.

---

## 10. Production deployment checklist

Tick every box before you announce the site.

**Content & correctness**
- [ ] Proofread all pages (spelling, Hebrew grammar, phone numbers, links).
- [ ] **Reconcile the email domain.** The pages currently reference emails like `hello@aiofficeworker.com` (no hyphens) while the website domain is `ai-office-worker.com` (with hyphens). Pick one and make them match everywhere, and make sure that mailbox actually exists.
- [ ] Replace any placeholder text (team bios, testimonials marked as placeholders).
- [ ] A lawyer has reviewed the Privacy Policy and Terms for your jurisdiction.

**Functionality**
- [ ] **Forms are wired** to a real endpoint (Section 2b) and you received a test submission.
- [ ] Every navigation link and footer link opens the correct page.
- [ ] Favicon tags added to all 7 pages (Section 2a) — the tab icon shows.

**SEO & analytics**
- [ ] Google Analytics tag installed on all pages and verified in Realtime (Section 8).
- [ ] Open Graph / canonical tags added (Section 7b) — test the link preview by pasting it into WhatsApp to yourself.
- [ ] `robots.txt` and `sitemap.xml` are live (visit `https://ai-office-worker.com/sitemap.xml`).
- [ ] Site submitted to Google Search Console and sitemap submitted (Section 7d).

**Domain & security**
- [ ] Custom domain `ai-office-worker.com` resolves to the site.
- [ ] **HTTPS padlock** shows (no "Not secure" warning).
- [ ] `www` and non-`www` both reach the site and redirect to your chosen primary version.

**Performance & compatibility**
- [ ] Tested on Chrome, Safari, and at least one mobile browser.
- [ ] Lighthouse mobile score is healthy (Section 9).
- [ ] Pages load quickly on a phone connection.

**Nice-to-have polish**
- [ ] A simple `404.html` page exists (Vercel/Render serve it automatically if present).
- [ ] Cookie-consent banner added if you use analytics (Section 8 note).
- [ ] Your code is backed up on GitHub (so you never lose it).

**Still on the roadmap**
- [ ] The full **Hebrew / RTL version** of the site (currently the site copy is in English with Hebrew branding). When that build is ready, redeploy the same way — the hosting and domain steps above don't change.

---

## Glossary (plain English)

- **Static site** — a website made of fixed files; no database or server logic. Cheap, fast, secure.
- **Host / hosting** — the company whose computers serve your files to visitors (Vercel, Render).
- **Domain / registrar** — your web address (`ai-office-worker.com`) and the company you bought it from (Namecheap).
- **DNS** — the internet's address book; it points your domain at your host.
- **DNS record (A / CNAME / ALIAS)** — individual entries in that address book. An **A record** points to a numeric IP; a **CNAME/ALIAS** points to another web address.
- **Propagation** — the waiting time for DNS changes to spread worldwide (minutes to ~24h).
- **HTTPS / SSL** — the secure padlock; encrypts traffic. Your host sets it up free and automatically.
- **Favicon** — the small icon in the browser tab.
- **GA4 / Measurement ID** — Google Analytics 4 and its `G-XXXX` code that links your site to your stats.
- **Repository (repo)** — a folder of your code stored on GitHub.
- **CDN** — a worldwide network of servers that delivers your site fast from a location near each visitor.

---

*You've got this. Deploy to a `.vercel.app` link first, click around on your phone, then connect the domain. Take it one section at a time.*
