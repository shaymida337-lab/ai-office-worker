# Go Live — AI Office Worker

This is the **fast path** to getting the site live on **ai-office-worker.com** with working forms. Three stages, about 30–45 minutes total, no coding required.

```
Stage 1 · Forms      → Formspree (so the waitlist actually emails you)
Stage 2 · Hosting    → GitHub + Vercel (puts the site on the internet)
Stage 3 · Domain     → Namecheap DNS (points ai-office-worker.com at it)
```

> Do **Stage 1 first** so the live site already has working forms. If you'd rather get the site up first and wire forms after, that's fine too — the forms safely show a success message until you connect them.

---

## Stage 1 — Connect the forms (Formspree)

The site has two forms: the **waitlist** (home page) and the **contact** form (contact page). They route to different inboxes:

| Form | Recipient | Why |
|---|---|---|
| Waitlist | **info@ai-office-worker.com** | general communication / signups |
| Contact | **hello@ai-office-worker.com** | direct contact messages |

(A third address, **support@ai-office-worker.com**, is shown on the contact page for future customer support — set that mailbox up when you launch.)

### 1.1 Create the forms
1. Go to **https://formspree.io** and create a free account (sign up with **info@ai-office-worker.com** so ownership lives on the main inbox).
2. Click **+ New Form**. Name it **`AI Office Worker — Waitlist`**.
3. Set **Send emails to:** `info@ai-office-worker.com` → **Create Form**.
4. Repeat: **+ New Form** → **`AI Office Worker — Contact`** → recipient `hello@ai-office-worker.com`.

### 1.2 Copy the two form IDs
Each form has an endpoint like `https://formspree.io/f/`**`mqakzbrd`**. The 8-character code at the end is the **form ID**. Copy both.

### 1.3 Paste the IDs into the site
Open **`assets/script.js`** and find these two lines near the top of the form section:

```js
var FORMSPREE_WAITLIST_ID = "";   // paste the Waitlist form ID here
var FORMSPREE_CONTACT_ID  = "";   // paste the Contact form ID here
```

Fill them in, e.g.:

```js
var FORMSPREE_WAITLIST_ID = "mqakzbrd";
var FORMSPREE_CONTACT_ID  = "xvgakwpe";
```

Now do the **exact same edit** in **`he/assets/script.js`** (the Hebrew site uses the same two IDs).

### 1.4 Allow your domain
In each form's **Settings → Allowed Domains**, add `ai-office-worker.com` (and, while testing, `localhost`). This stops others embedding your forms.

### 1.5 Spam protection — reCAPTCHA v3 (invisible)
The forms are pre-wired for **Google reCAPTCHA v3**, which is invisible (no checkbox, no puzzle) and verified by Formspree server-side. To turn it on:
1. Go to **https://www.google.com/recaptcha/admin**, register a site, choose **reCAPTCHA v3**, and add the domains `ai-office-worker.com` and `www.ai-office-worker.com`. You'll get a **Site key** and a **Secret key**.
2. Paste the **Site key** into `RECAPTCHA_SITE_KEY` near the top of the form section in **both** `assets/script.js` and `he/assets/script.js`.
3. In **each** Formspree form: **Settings → reCAPTCHA → Custom reCAPTCHA**, and paste the **Secret key** there. (This is what makes Formspree actually verify the token — without it the CAPTCHA is decorative.)

That's it. reCAPTCHA loads only on pages that contain a form, the badge is hidden, and a small "protected by reCAPTCHA" disclosure appears under each form (required by Google, and already built in). A honeypot field also runs as a second layer.

> Leave `RECAPTCHA_SITE_KEY` blank during local preview — forms still validate and submit (honeypot only). Add the key before launch.

### 1.6 Test
Open the home page, enter your own email in the waitlist, submit. You should see the success state **and** receive an email at info@ai-office-worker.com within a minute. (Formspree sends a one-time confirmation to each recipient address on its first submission — click the link in it.) Repeat on the contact page to confirm hello@ receives it.

> **Free plan** covers 50 submissions/month per form. Upgrade later with no code changes.

---

## Stage 2 — Put the site online (GitHub + Vercel)

Vercel hosts static sites for free, gives you automatic HTTPS, and redeploys every time you push to GitHub.

### 2.1 Put the project on GitHub
**Option A — GitHub Desktop (easiest, no terminal):**
1. Install **GitHub Desktop** and sign in.
2. **File → New Repository** → name it `ai-office-worker` → choose this project folder → **Create**.
3. **Publish repository** (keep it **Private** if you prefer). Done.

**Option B — Command line:**
```bash
cd ai-office-worker
git init
git add .
git commit -m "Launch: AI Office Worker site"
git branch -M main
# create an empty repo named ai-office-worker on github.com first, then:
git remote add origin https://github.com/YOUR_USERNAME/ai-office-worker.git
git push -u origin main
```

> Before pushing, you can delete the **`_build/`** and **`brand/`** folders if you want the leanest repo — neither is served to visitors. Everything else deploys as-is.

### 2.2 Import into Vercel
1. Go to **https://vercel.com** and sign up **with your GitHub account**.
2. **Add New… → Project** → **Import** your `ai-office-worker` repo.
3. **Framework Preset:** select **Other** (this is a plain static site — no build step).
4. Leave **Build Command** empty and **Output Directory** as the root (`.`). The included **`vercel.json`** already handles clean URLs, caching, and headers.
5. Click **Deploy**.

After ~30 seconds you'll get a live URL like `ai-office-worker.vercel.app`. Open it and click around — both the English site and the Hebrew site at `/he/` should work, and the custom 404 should appear on a bad URL.

> **Every future change:** edit files → push to GitHub → Vercel redeploys automatically. No manual uploads.

---

## Stage 3 — Connect ai-office-worker.com (Namecheap)

You'll add the domain in Vercel, then point Namecheap's DNS at Vercel.

### 3.1 Add the domain in Vercel
1. In your Vercel project: **Settings → Domains**.
2. Type `ai-office-worker.com` → **Add**.
3. Vercel will prompt to also add **`www.ai-office-worker.com`** and recommend redirecting one to the other — accept (apex `ai-office-worker.com` as primary is a good default).
4. Vercel now shows the exact DNS records to create. **Use the values Vercel shows you** — they're usually:
   - **A record** for the apex: name `@` → **`76.76.21.21`** *(Vercel may show a different IP from its pool, e.g. `216.198.79.1` — use whatever it displays.)*
   - **CNAME** for www: name `www` → **`cname.vercel-dns.com`**

Keep this Vercel tab open so you can copy the exact values.

### 3.2 Set the records in Namecheap
1. Log in to **Namecheap → Domain List →** click **Manage** next to `ai-office-worker.com`.
2. Open the **Advanced DNS** tab.
3. **Remove the default parking records** Namecheap adds (usually a `CNAME` on `@`/`www` pointing to `parkingpage.namecheap.com`, and any sample `URL Redirect`). Leaving these will block your site.
4. **Add New Record →**
   - **A Record** — Host: `@` — Value: `76.76.21.21` (or the IP Vercel showed) — TTL: Automatic
   - **CNAME Record** — Host: `www` — Value: `cname.vercel-dns.com` — TTL: Automatic
5. **Save All Changes.**

> Keep any **MX / email records** you already use — DNS for the website (A/CNAME) doesn't affect email, as long as you don't delete the mail records.

### 3.3 Wait and verify
- DNS usually propagates in **5–30 minutes** (can take up to a few hours).
- Back in **Vercel → Settings → Domains**, the domain flips from "Invalid Configuration" to a green **Valid** check when it sees the records.
- Vercel then **auto-issues an SSL certificate** — `https://ai-office-worker.com` goes live with the padlock automatically. No action needed.

When it's green: visit **https://ai-office-worker.com** and **https://ai-office-worker.com/he/**, submit the waitlist with your own email, and confirm it lands in info@ai-office-worker.com. 🎉

---

## Launch checklist

- [ ] Both Formspree IDs pasted into **`assets/script.js`** *and* **`he/assets/script.js`**
- [ ] Recipients set on Formspree: **Waitlist → info@**, **Contact → hello@** (first-submission confirmed)
- [ ] reCAPTCHA v3 **Site key** in both `script.js` files; **Secret key** in each Formspree form (Custom reCAPTCHA)
- [ ] `ai-office-worker.com` added to Formspree **Allowed Domains** and to the reCAPTCHA site's domains
- [ ] Repo pushed to GitHub and imported into Vercel; `.vercel.app` URL works
- [ ] Apex **A** record + **www CNAME** set in Namecheap; parking records removed
- [ ] Vercel shows the domain as **Valid** and HTTPS padlock is live
- [ ] Test waitlist submission received at info@ai-office-worker.com (EN and HE)
- [ ] *(Optional)* Analytics: set `GA_MEASUREMENT_ID` to your `G-…` ID in **both** `assets/script.js` and `he/assets/script.js`. Analytics then loads only after a visitor accepts the cookie banner.
- [ ] *(Optional)* Submit `https://ai-office-worker.com/sitemap.xml` in Google Search Console

---

## Cookie consent (already built in)

A bilingual cookie-consent banner ships with the site and needs **no setup**:

- On a visitor's first arrival it appears at the bottom with **Accept** / **Decline** and a link to the Privacy Policy. It auto-shows Hebrew on `/he/` pages and English elsewhere.
- **Analytics only loads after “Accept.”** If a visitor declines (or ignores), Google Analytics is never loaded and no analytics cookies are set.
- Visitors can change their mind anytime via the **“Cookie settings”** link added to the footer.
- The choice is remembered for 12 months, then the banner asks again.

So your analytics are consent-gated out of the box — appropriate for GDPR/EU and Israeli visitors. Just add your `GA_MEASUREMENT_ID` (above) if you want analytics at all; leave it blank to keep the site analytics-free while still recording consent choices.

---

## Quick troubleshooting

| Symptom | Fix |
|---|---|
| Form shows success but no email arrives | Confirm the one-time Formspree recipient verification email; check the ID is pasted in **both** script files; make sure the reCAPTCHA Secret key is set in the Formspree form, and the Site key matches in script.js. |
| Form does nothing / console shows a CORS or 403 error | Add `ai-office-worker.com` to the form's **Allowed Domains** in Formspree. |
| Vercel domain stuck on "Invalid Configuration" | Parking records still present in Namecheap, or DNS hasn't propagated yet — remove parking records and wait. |
| Site works on `.vercel.app` but not the domain | The A/CNAME values don't match what Vercel shows — recopy them exactly. |
| Hebrew site 404s | Make sure the whole `he/` folder was pushed to GitHub. |

For the deeper reference (Render alternative, SEO submission, GA consent banner, etc.) see **`DEPLOYMENT.md`**.
