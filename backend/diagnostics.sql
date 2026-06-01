WITH r AS (
  SELECT
    c.id,
    c.name,
    c.email,
    c.domain,
    COUNT(i.id) AS invoices,
    COUNT(i.id) FILTER (WHERE i.status = 'paid') AS paid_invoices,
    COALESCE(SUM(i.amount) FILTER (WHERE i.status NOT IN ('paid', 'cancelled', 'void')), 0) AS outstanding,
    COUNT(sp.id) AS supplier_payments,
    STRING_AGG(
      DISTINCT CASE
        WHEN lower(c.name || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.domain, '')) ~ '(openai|netlify|anthropic|stripe|paypal|google|cloudflare|render|github|vercel|aws|amazon|microsoft|meta|facebook|apple|twilio|sendgrid)' THEN 'known vendor name/domain'
        WHEN sp.id IS NOT NULL THEN 'has matching supplier payment'
        WHEN c.email LIKE 'invoice-%@local.invalid' THEN 'local invoice placeholder email'
      END,
      '; '
    ) AS why
  FROM "Client" c
  LEFT JOIN "Invoice" i ON i."clientId" = c.id
  LEFT JOIN "SupplierPayment" sp
    ON sp."organizationId" = c."organizationId"
    AND (
      lower(sp.supplier) = lower(c.name)
      OR lower(coalesce(sp."supplierName", '')) = lower(c.name)
      OR lower(coalesce(sp."emailSender", '')) LIKE '%' || lower(coalesce(c.domain, '')) || '%'
    )
  GROUP BY c.id
  HAVING
    COUNT(i.id) FILTER (WHERE i.status = 'paid') = 0
    AND (
      COUNT(sp.id) > 0
      OR lower(c.name || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.domain, '')) ~ '(openai|netlify|anthropic|stripe|paypal|google|cloudflare|render|github|vercel|aws|amazon|microsoft|meta|facebook|apple|twilio|sendgrid)'
      OR c.email LIKE 'invoice-%@local.invalid'
    )
)
SELECT
  id,
  name,
  email,
  domain,
  invoices,
  paid_invoices,
  outstanding,
  supplier_payments,
  why
FROM r
ORDER BY outstanding DESC, invoices DESC
LIMIT 50;

WITH r AS (
  SELECT
    c.id,
    COUNT(i.id) AS invoices,
    COUNT(i.id) FILTER (WHERE i.status = 'paid') AS paid_invoices,
    COUNT(sp.id) AS supplier_payments,
    (
      lower(c.name || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.domain, '')) ~ '(openai|netlify|anthropic|stripe|paypal|google|cloudflare|render|github|vercel|aws|amazon|microsoft|meta|facebook|apple|twilio|sendgrid)'
      OR c.email LIKE 'invoice-%@local.invalid'
    ) AS vendor_signal
  FROM "Client" c
  LEFT JOIN "Invoice" i ON i."clientId" = c.id
  LEFT JOIN "SupplierPayment" sp
    ON sp."organizationId" = c."organizationId"
    AND (
      lower(sp.supplier) = lower(c.name)
      OR lower(coalesce(sp."supplierName", '')) = lower(c.name)
      OR lower(coalesce(sp."emailSender", '')) LIKE '%' || lower(coalesce(c.domain, '')) || '%'
    )
  GROUP BY c.id
)
SELECT
  CASE
    WHEN paid_invoices = 0 AND (supplier_payments > 0 OR vendor_signal) THEN 'suspected_fake_supplier_placeholder'
    WHEN paid_invoices > 0 THEN 'likely_real_customer_paid_business'
    WHEN invoices > 0 THEN 'possible_real_customer_unpaid_only'
    ELSE 'unknown_no_invoice_history'
  END AS bucket,
  COUNT(*) AS clients
FROM r
GROUP BY 1
ORDER BY 1;

WITH r AS (
  SELECT
    c.id,
    COUNT(i.id) FILTER (WHERE i.status = 'paid') AS paid_invoices,
    COUNT(sp.id) AS supplier_payments,
    (
      lower(c.name || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.domain, '')) ~ '(openai|netlify|anthropic|stripe|paypal|google|cloudflare|render|github|vercel|aws|amazon|microsoft|meta|facebook|apple|twilio|sendgrid)'
      OR c.email LIKE 'invoice-%@local.invalid'
    ) AS vendor_signal
  FROM "Client" c
  LEFT JOIN "Invoice" i ON i."clientId" = c.id
  LEFT JOIN "SupplierPayment" sp
    ON sp."organizationId" = c."organizationId"
    AND (
      lower(sp.supplier) = lower(c.name)
      OR lower(coalesce(sp."supplierName", '')) = lower(c.name)
      OR lower(coalesce(sp."emailSender", '')) LIKE '%' || lower(coalesce(c.domain, '')) || '%'
    )
  GROUP BY c.id
),
inv AS (
  SELECT
    i.*,
    CASE
      WHEN r.paid_invoices = 0 AND (r.supplier_payments > 0 OR r.vendor_signal) THEN 'suspected_fake'
      WHEN r.paid_invoices > 0 THEN 'real_paid_history'
      ELSE 'unpaid_only_or_unknown'
    END AS bucket
  FROM "Invoice" i
  JOIN r ON r.id = i."clientId"
  WHERE i.status NOT IN ('paid', 'cancelled', 'void')
)
SELECT
  bucket,
  COUNT(*) AS open_invoices,
  ROUND(SUM(amount)::numeric, 2) AS money_to_collect
FROM inv
GROUP BY bucket
UNION ALL
SELECT
  'TOTAL',
  COUNT(*),
  ROUND(SUM(amount)::numeric, 2)
FROM inv
ORDER BY bucket;

WITH r AS (
  SELECT
    c.id,
    c.name,
    c.email,
    c.domain,
    COUNT(i.id) FILTER (WHERE i.status = 'paid') AS paid_invoices,
    COUNT(sp.id) AS supplier_payments,
    (
      lower(c.name || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.domain, '')) ~ '(openai|netlify|anthropic|stripe|paypal|google|cloudflare|render|github|vercel|aws|amazon|microsoft|meta|facebook|apple|twilio|sendgrid)'
      OR c.email LIKE 'invoice-%@local.invalid'
    ) AS vendor_signal
  FROM "Client" c
  LEFT JOIN "Invoice" i ON i."clientId" = c.id
  LEFT JOIN "SupplierPayment" sp
    ON sp."organizationId" = c."organizationId"
    AND (
      lower(sp.supplier) = lower(c.name)
      OR lower(coalesce(sp."supplierName", '')) = lower(c.name)
      OR lower(coalesce(sp."emailSender", '')) LIKE '%' || lower(coalesce(c.domain, '')) || '%'
    )
  GROUP BY c.id
)
SELECT
  i.id AS invoice_id,
  c.name AS client_name,
  c.email,
  c.domain,
  i."invoiceNumber",
  i.amount,
  i.status,
  i."supplierName",
  i."fromEmail",
  i."createdAt"
FROM "Invoice" i
JOIN "Client" c ON c.id = i."clientId"
JOIN r ON r.id = c.id
WHERE
  i.status NOT IN ('paid', 'cancelled', 'void')
  AND r.paid_invoices = 0
  AND (r.supplier_payments > 0 OR r.vendor_signal)
ORDER BY i.amount DESC
LIMIT 50;

SELECT
  CASE
    WHEN lower(title || ' ' || coalesce(description, '') || ' ' || coalesce(supplier, '')) ~ '(security alert|google security|login alert|new sign-in|otp|verification code|password reset|github|dependabot|render|deployment failed|deployment succeeded|newsletter|unsubscribe|promotion|system notification|הודעת מערכת|אבטחה|קוד אימות|איפוס סיסמה|ניוזלטר|פרסומת)' THEN 'suspected_junk_automated'
    ELSE 'likely_real_or_needs_review'
  END AS bucket,
  COUNT(*) AS tasks
FROM "Task"
GROUP BY 1
ORDER BY 1;

SELECT
  id,
  title,
  supplier,
  priority,
  status,
  source,
  "createdAt",
  substring(coalesce(description, ''), 1, 160) AS description_sample
FROM "Task"
WHERE lower(title || ' ' || coalesce(description, '') || ' ' || coalesce(supplier, '')) ~ '(security alert|google security|login alert|new sign-in|otp|verification code|password reset|github|dependabot|render|deployment failed|deployment succeeded|newsletter|unsubscribe|promotion|system notification|הודעת מערכת|אבטחה|קוד אימות|איפוס סיסמה|ניוזלטר|פרסומת)'
ORDER BY "createdAt" DESC
LIMIT 50;
