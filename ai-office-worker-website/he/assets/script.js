/* ==========================================================================
   AI Office Worker — interactions
   ========================================================================== */
(function () {
  "use strict";

  /* ----- Current year ----- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ----- Sticky nav state + mobile toggle ----- */
  var nav = document.querySelector(".nav");
  var toggle = document.querySelector(".nav-toggle");

  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 12);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll(".nav-links a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ----- Scroll reveal ----- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ----- FAQ accordion ----- */
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q");
    var a = item.querySelector(".faq-a");
    if (!q || !a) return;
    q.addEventListener("click", function () {
      var isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(function (other) {
        if (other !== item) {
          other.classList.remove("open");
          other.querySelector(".faq-a").style.maxHeight = null;
          other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
        }
      });
      item.classList.toggle("open", !isOpen);
      q.setAttribute("aria-expanded", !isOpen ? "true" : "false");
      a.style.maxHeight = !isOpen ? a.scrollHeight + "px" : null;
    });
  });

  /* ----- Animated counters ----- */
  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    if (!isFinite(target)) return;
    var suffix = el.getAttribute("data-suffix") || "";
    var decimals = (target % 1 !== 0) ? 1 : 0;
    var start = 0, dur = 1600, t0 = null;
    function tick(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = (start + (target - start) * eased).toFixed(decimals);
      el.textContent = val + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  var counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && counters.length) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { animateCount(e.target); cio.unobserve(e.target); }
      });
    }, { threshold: 0.6 });
    counters.forEach(function (c) { cio.observe(c); });
  }

  /* ========================================================================
     טיפול בטפסים — Formspree + reCAPTCHA v3 (בלתי-נראה)
     ------------------------------------------------------------------------
     הגדרה חד-פעמית (ראו GO-LIVE.md → "Forms" + "Spam protection"):
       1. נרשמים בחינם ב-https://formspree.io
       2. יוצרים שני טפסים:
            • "AI Office Worker — Waitlist" → נמען info@ai-office-worker.com
            • "AI Office Worker — Contact"  → נמען hello@ai-office-worker.com
       3. מעתיקים את מזהה הטופס (8 תווים) מכתובת ה-endpoint לשני הקבועים שלמטה.
       4. CAPTCHA: יוצרים מפתח reCAPTCHA **v3** ב-
          https://www.google.com/recaptcha/admin (מוסיפים ai-office-worker.com),
          מדביקים את ה-SITE key ב-RECAPTCHA_SITE_KEY שלמטה, ואת ה-SECRET key
          בהגדרות ה-CAPTCHA של כל טופס ב-Formspree (Custom reCAPTCHA).
       5. מוסיפים ai-office-worker.com ל-"Allowed domains" בכל טופס.
     עד שממלאים מזהים/מפתחות — הטפסים מאמתים ומציגים הצלחה בלי לשלוח (תצוגה מקומית).
     reCAPTCHA נטען רק בעמודים שיש בהם טופס.
     ======================================================================== */
  var FORMSPREE_WAITLIST_ID = "";  // לדוגמה "mqakzbrd"
  var FORMSPREE_CONTACT_ID  = "";  // לדוגמה "xvgakwpe"
  var RECAPTCHA_SITE_KEY    = "";  // reCAPTCHA v3 SITE key, למשל "6Lc...your-site-key"

  var FS_BASE = "https://formspree.io/f/";

  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  /* שדה דבש נסתר נגד ספאם — בוטים ממלאים, משתמשים לא רואים. */
  function addHoneypot(form) {
    if (form.querySelector('input[name="_gotcha"]')) return;
    var hp = document.createElement("input");
    hp.type = "text"; hp.name = "_gotcha"; hp.tabIndex = -1;
    hp.setAttribute("autocomplete", "off");
    hp.setAttribute("aria-hidden", "true");
    hp.style.cssText = "position:fixed!important;top:-100vh!important;left:0!important;width:1px;height:1px;opacity:0;pointer-events:none";
    form.appendChild(hp);
  }

  /* שליחה ל-Formspree. מצליח → resolve; נכשל → reject עם הודעה.
     אם לא הוגדר מזהה טופס — מדמה הצלחה (תצוגה מקומית).                       */
  function submitToFormspree(id, data) {
    if (!id) {
      return new Promise(function (resolve) { setTimeout(resolve, 600); });
    }
    return fetch(FS_BASE + id, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: data
    }).then(function (res) {
      if (res.ok) return true;
      throw "error";
    });
  }

  /* ----- reCAPTCHA v3 (בלתי-נראה) ----------------------------------------- */
  function loadRecaptcha() {
    if (!RECAPTCHA_SITE_KEY || window.__aowRC) return;
    if (!document.querySelector(".wl-form, #contact-form")) return;
    window.__aowRC = true;
    var s = document.createElement("script");
    s.src = "https://www.google.com/recaptcha/api.js?render=" + encodeURIComponent(RECAPTCHA_SITE_KEY);
    s.async = true;
    document.head.appendChild(s);
    injectCaptchaDisclosure();
  }

  function getCaptchaToken(action) {
    return new Promise(function (resolve) {
      if (!RECAPTCHA_SITE_KEY || !window.grecaptcha || !window.grecaptcha.execute) { resolve(""); return; }
      try {
        window.grecaptcha.ready(function () {
          window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: action })
            .then(function (t) { resolve(t || ""); })
            .catch(function () { resolve(""); });
        });
      } catch (e) { resolve(""); }
    });
  }

  function injectCaptchaDisclosure() {
    var html = 'אתר זה מוגן על ידי reCAPTCHA ובכפוף ל<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">מדיניות הפרטיות</a> ול<a href="https://policies.google.com/terms" target="_blank" rel="noopener">תנאי השימוש</a> של Google.';
    document.querySelectorAll(".wl-form, #contact-form").forEach(function (form) {
      var host = form.parentElement;
      if (host.querySelector(".captcha-note")) return;
      var n = document.createElement("p");
      n.className = "captcha-note";
      n.innerHTML = html;
      form.insertAdjacentElement("afterend", n);
    });
  }

  /* ----- טופסי רשימת המתנה ----- */
  document.querySelectorAll(".wl-form").forEach(function (form) {
    var input = form.querySelector('input[type="email"]');
    var errEl = form.parentElement.querySelector(".wl-error");
    var successEl = form.parentElement.querySelector(".wl-success");
    addHoneypot(form);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = (input.value || "").trim();
      if (errEl) errEl.textContent = "";

      if (!isEmail(email)) {
        if (errEl) errEl.textContent = "נא להזין כתובת אימייל תקינה.";
        input.focus();
        return;
      }

      var btn = form.querySelector('button[type="submit"]') || form.querySelector("button");
      var original = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.innerHTML = "מצטרפים…"; }

      function done() {
        if (successEl) {
          form.style.display = "none";
          var note = form.parentElement.querySelector(".wl-note");
          if (note) note.style.display = "none";
          successEl.classList.add("show");
          var out = successEl.querySelector("[data-email]");
          if (out) out.textContent = email;
        }
      }

      var data = new FormData();
      data.append("email", email);
      data.append("_subject", "הרשמה חדשה לרשימת המתנה — עובד משרד AI");
      data.append("source", "waitlist-he");
      data.append("locale", document.documentElement.lang || "he");
      data.append("page", location.href);
      var hp = form.querySelector('input[name="_gotcha"]');
      if (hp) data.append("_gotcha", hp.value);

      getCaptchaToken("waitlist").then(function (token) {
        if (token) data.append("g-recaptcha-response", token);
        submitToFormspree(FORMSPREE_WAITLIST_ID, data)
          .then(done)
          .catch(function () {
            if (errEl) errEl.textContent = "משהו השתבש. נסו שוב.";
            if (btn) { btn.disabled = false; btn.innerHTML = original; }
          });
      });
    });
  });

  /* ----- טופס יצירת קשר ----- */
  var contactForm = document.querySelector("#contact-form");
  if (contactForm) {
    addHoneypot(contactForm);

    var cErr = contactForm.querySelector(".form-error");
    if (!cErr) {
      cErr = document.createElement("div");
      cErr.className = "form-error";
      cErr.setAttribute("role", "alert");
      cErr.setAttribute("aria-live", "polite");
      cErr.style.cssText = "color:#dc2626;font-weight:600;font-size:.9rem;margin-bottom:.8rem;min-height:1rem;text-align:right";
      var submitBtn = contactForm.querySelector('button[type="submit"]') || contactForm.querySelector("button");
      contactForm.insertBefore(cErr, submitBtn);
    }

    contactForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var ok = contactForm.querySelector(".form-success");
      var emailField = contactForm.querySelector('input[type="email"]');
      cErr.textContent = "";

      if (contactForm.checkValidity && !contactForm.checkValidity()) {
        if (contactForm.reportValidity) contactForm.reportValidity();
        return;
      }

      if (emailField && !isEmail(emailField.value.trim())) {
        cErr.textContent = "נא להזין כתובת אימייל תקינה.";
        emailField.focus();
        return;
      }

      var btn = contactForm.querySelector('button[type="submit"]') || contactForm.querySelector("button");
      var original = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.innerHTML = "שולחים…"; }

      var data = new FormData(contactForm);
      data.append("_subject", "הודעה חדשה מטופס יצירת קשר — עובד משרד AI");
      data.append("source", "contact-he");
      data.append("locale", document.documentElement.lang || "he");

      getCaptchaToken("contact").then(function (token) {
        if (token) data.append("g-recaptcha-response", token);
        submitToFormspree(FORMSPREE_CONTACT_ID, data)
          .then(function () {
            contactForm.querySelectorAll("input,textarea,select,button").forEach(function (f) { f.disabled = true; });
            if (ok) ok.style.display = "flex";
          })
          .catch(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = original; }
            cErr.textContent = "משהו השתבש. נסו שוב.";
          });
      });
    });
  }

  /* הפעלת reCAPTCHA בלתי-נראה בעמודים שיש בהם טופס. */
  loadRecaptcha();
})();

/* ==========================================================================
   Cookie consent + Analytics (consent-gated)
   --------------------------------------------------------------------------
   Analytics loads ONLY after the visitor accepts. To enable Google Analytics:
   set GA_MEASUREMENT_ID below to your GA4 ID (e.g. "G-XXXXXXXXXX") in BOTH
   assets/script.js and he/assets/script.js. Leave blank to keep analytics off
   entirely (the banner still works and simply records the visitor's choice).
   The banner is bilingual and auto-detects the page language.
   ========================================================================== */
(function () {
  "use strict";

  var GA_MEASUREMENT_ID = ""; // e.g. "G-XXXXXXXXXX"
  var STORAGE_KEY = "aow_consent_v1";
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // re-ask after 12 months

  var isHe = (document.documentElement.lang || "en").toLowerCase().indexOf("he") === 0;
  var T = isHe ? {
    text: 'אנחנו משתמשים בעוגיות אנליטיקה כדי להבין כיצד נעשה שימוש באתר ולשפר את החוויה. ניתן לאשר או לדחות.',
    accept: "אישור", decline: "דחייה", privacy: "מדיניות פרטיות", settings: "הגדרות עוגיות"
  } : {
    text: "We use analytics cookies to understand how the site is used and improve your experience. You can accept or decline.",
    accept: "Accept", decline: "Decline", privacy: "Privacy Policy", settings: "Cookie settings"
  };

  function save(v) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: v, t: Date.now() })); } catch (e) {}
  }
  function read() {
    try {
      var r = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!r || (Date.now() - r.t) > MAX_AGE_MS) return null;
      return r.v;
    } catch (e) { return null; }
  }

  function loadAnalytics() {
    if (!GA_MEASUREMENT_ID || window.__aowGA) return;
    window.__aowGA = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("consent", "default", { ad_storage: "denied", analytics_storage: "denied" });
    gtag("consent", "update", { analytics_storage: "granted" });
    gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true });
  }

  var bannerEl = null;
  function hide() { if (bannerEl) bannerEl.classList.remove("show"); }

  function buildBanner() {
    if (bannerEl) { bannerEl.classList.add("show"); return; }
    var privacyHref = "privacy.html"; // sits beside every page in both EN and HE
    var b = document.createElement("aside");
    b.className = "cc-banner";
    b.setAttribute("role", "dialog");
    b.setAttribute("aria-live", "polite");
    b.setAttribute("aria-label", T.settings);
    b.innerHTML =
      '<span class="cc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
      '<path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-4-4 .9.9 0 0 0-1-1z" stroke-linejoin="round"/>' +
      '<circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1" fill="currentColor" stroke="none"/></svg></span>' +
      '<p>' + T.text + ' <a href="' + privacyHref + '">' + T.privacy + '</a></p>' +
      '<div class="cc-actions">' +
      '<button type="button" class="btn btn-ghost" data-cc="decline">' + T.decline + '</button>' +
      '<button type="button" class="btn btn-primary" data-cc="accept">' + T.accept + '</button>' +
      '</div>';
    document.body.appendChild(b);
    bannerEl = b;
    b.querySelector('[data-cc="accept"]').addEventListener("click", function () {
      save("granted"); hide(); loadAnalytics();
    });
    b.querySelector('[data-cc="decline"]').addEventListener("click", function () {
      save("denied"); hide();
    });
    requestAnimationFrame(function () { requestAnimationFrame(function () { b.classList.add("show"); }); });
  }

  // Footer "Cookie settings" link lets visitors change their mind anytime.
  function injectSettingsLink() {
    var foot = document.querySelector(".footer-bottom");
    if (!foot || foot.querySelector(".cc-settings")) return;
    var sep = document.createTextNode(" · ");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cc-settings";
    btn.textContent = T.settings;
    btn.addEventListener("click", buildBanner);
    foot.appendChild(sep);
    foot.appendChild(btn);
  }

  function init() {
    injectSettingsLink();
    var choice = read();
    if (choice === "granted") { loadAnalytics(); }
    else if (choice == null) { buildBanner(); }
    // "denied" → do nothing; respect the choice without nagging.
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
