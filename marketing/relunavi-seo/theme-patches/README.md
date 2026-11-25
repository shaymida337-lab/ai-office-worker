# תיקוני קוד לערכת העיצוב — מוכנים להחלה (ממתינים להרשאה/אישור)

ערכת העיצוב החיה: **RELUNAVI Knee CRO 2026-11-11** (`gid://shopify/OnlineStoreTheme/192682590520`).
עריכת קוד הערכה נחסמה מהחיבור הנוכחי ל-Shopify ("This connector requires additional permissions").
לכן הקבצים כאן מוכנים להחלה אחרי חיבור מחדש של Shopify עם הרשאת עריכת ערכה, או ידנית ב-Online Store → Themes → Edit code.

לפני החלה: **שכפלו את הערכה** (בחנות יש כרגע 20 ערכות, המקסימום של Shopify — צריך למחוק ערכה ישנה אחת, למשל אחת משתי "Copy of RELUNAVI Premium Product Redesign" מ-29.10, כדי לפנות מקום לגיבוי).

## 1. נתונים מובנים לכל המוצרים (בטוח — ללא שינוי חזותי)
**הבעיה:** N7, מעסה הקרקפת ואקדח העיסוי ללא Product schema (רק מעסה השיאצו מקבל אותו). בכל המוצרים חסרים `shippingDetails` ו-`hasMerchantReturnPolicy` (אזהרות ב-Search Console). אין BreadcrumbList.
**ההחלה:**
1. צרו את `snippets/rln-product-jsonld.liquid` מהקובץ `snippets_rln-product-jsonld.liquid` שכאן.
2. ב-`sections/premium-product.liquid` החליפו את 3 השורות:
   ```liquid
   {% if request.page_type == 'product' and product.handle == 'shiatsu-neck-shoulder-massager-with-heat' %}
     <script type="application/ld+json">{{ product | structured_data }}</script>
   {% endif %}
   ```
   ב: `{% if request.page_type == 'product' %}{% render 'rln-product-jsonld', product: product %}{% endif %}`
3. ב-`sections/knee-product.liquid` מחקו את בלוק `<script type="application/ld+json"> … </script>` (אחרי `</section>`) והוסיפו במקומו: `{% render 'rln-product-jsonld', product: product %}`
**בדיקה:** https://search.google.com/test/rich-results על דף N7 — צריך להופיע Product + Merchant listing ללא אזהרות משלוח/החזרה.

## 2. קפיצת עמוד (CLS 0.86) בדף מעסה הברכיים (בטוח — ללא שינוי חזותי)
**הבעיה:** ב-`sections/knee-product.liquid` בלוק ה-`<style>` נמצא בסוף הקטע, אחרי ה-HTML. הדפדפן מצייר את הדף בלי עיצוב ואז הכול קופץ (נמדד: CLS 0.86–0.89 בטאבלט/מחשב; יעד ≤0.1).
**ההחלה:** העבירו את כל הבלוק `<style> … </style>` (מ-`<style>` שאחרי ה-`<script>` של הגלריה ועד `</style>` שלפני `{% schema %}`) לתחילת הקובץ, מיד אחרי שורות ה-`{%- assign … -%}` ולפני `<section class='kp…'>`. אין לשנות את תוכן ה-CSS.
**בדיקה:** Lighthouse/PageSpeed בדסקטופ על /products/relunavi-heated-knee-massager — CLS צריך לרדת מתחת ל-0.1.

## 3. ‎N7 במובייל — כותרת, מחיר וכפתור במסך הראשון (שינוי תצוגה — דורש אישורכם)
**הבעיה:** במובייל הכפתור הראשון "הוספה לסל" נמצא ~2,080 פיקסלים מטה (כ-2.5 מסכים). בדף הברכיים כבר יש פתרון מוצלח: כותרת+מחיר+כפתור במסך הראשון ופס רכישה צף.
**הצעה:** להחיל על `premium-product.liquid` את אותו עיקרון סדר-במובייל (`display:contents` + `order`) שכבר קיים ב-`knee-product.liquid` עבור `.kp-knee`, ולהוסיף פס רכישה צף כמו `.kp-sticky`. לא לבצע לפני אישור.

## 4. כפתור "הוספה לסל" מוביל ישר לקופה (שינוי התנהגות — דורש אישורכם)
שני הכפתורים ("הוספה לסל" ו"קנייה מהירה") מעבירים ישירות לקופה. אפשרויות: (א) לשנות את התווית של הכפתור הראשון ל"לרכישה" (שינוי טקסט בלבד), או (ב) לגרום לו להוסיף לסל ולהציג את הסל. חשוב לבדוק אחרי השינוי שאירוע AddToCart ממשיך להגיע ל-Meta.

## 5. כותרת דף הבית ללא מילת מפתח (דורש אישורכם)
כותרת דף הבית היא "RELUNAVI — הרגע שלך להירגע" (מתוך מפתח התרגום `premium.footer_text` ב-`layout/theme.liquid`). הצעה: כותרת ייעודית לדף הבית, למשל "RELUNAVI — מכשירי עיסוי לצוואר, לגב ולברכיים", בלי לשנות את טקסט הפוטר.
