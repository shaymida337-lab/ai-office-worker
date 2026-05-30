export const uiTranslations = {
  businessTypes: {
    beauty_clinic: "קליניקת יופי",
    accountant: "משרד רואי חשבון",
    lawyer: "משרד עורכי דין",
    insurance_agency: "סוכנות ביטוח",
    real_estate: "משרד נדל״ן",
    ecommerce: "חנות אונליין",
    importer: "יבואן",
    service_business: "עסק שירותים",
    marketing_agency: "סוכנות שיווק",
    restaurant: "מסעדה",
    other: "אחר",
  },
  modules: {
    crm: "ניהול לקוחות",
    invoices: "חשבוניות",
    supplier_management: "ספקים ותשלומים",
    tasks: "משימות",
    whatsapp: "וואטסאפ",
    documents: "מסמכים",
    meetings: "פגישות",
    collections: "גבייה",
    employees: "צוות",
  },
  pains: {
    leads: "לידים",
    invoices: "חשבוניות",
    collections: "גבייה",
    customer_service: "שירות לקוחות",
    whatsapp: "וואטסאפ",
    tasks: "משימות",
    documents: "מסמכים",
  },
  sizes: {
    solo: "עצמאי / יחיד",
    "2_5": "2-5 עובדים",
    "6_20": "6-20 עובדים",
    "20_plus": "20+ עובדים",
  },
  crmSources: {
    manual: "ידני",
    whatsapp: "וואטסאפ",
    email: "מייל",
    website: "אתר",
    referral: "הפניה",
    facebook: "פייסבוק",
  },
  sequenceChannels: {
    whatsapp: "וואטסאפ",
    email: "מייל",
    sms: "מסרון",
  },
  statuses: {
    draft: "טיוטה",
    sent: "נשלח",
    approved: "אושר",
    rejected: "נדחה",
    pending: "ממתין",
    completed: "הושלם",
    running: "רץ",
    error: "שגיאה",
  },
} as const;

export const businessModules = [
  { id: "crm", label: uiTranslations.modules.crm, description: "לקוחות, לידים ותהליך מכירה" },
  { id: "invoices", label: uiTranslations.modules.invoices, description: "חשבוניות, קבלות והכנסות" },
  { id: "supplier_management", label: uiTranslations.modules.supplier_management, description: "ספקים, תשלומים וחשבוניות חסרות" },
  { id: "tasks", label: uiTranslations.modules.tasks, description: "משימות, תזכורות ומעקב עבודה" },
  { id: "whatsapp", label: uiTranslations.modules.whatsapp, description: "הודעות, התראות ותזכורות" },
  { id: "documents", label: uiTranslations.modules.documents, description: "דרייב, קבצים וסידור מסמכים" },
  { id: "meetings", label: uiTranslations.modules.meetings, description: "פגישות וסיכומי שיחה" },
  { id: "collections", label: uiTranslations.modules.collections, description: "גבייה ותזכורות תשלום" },
  { id: "employees", label: uiTranslations.modules.employees, description: "צוות, שיוכים ותפעול עובדים" },
] as const;

export const businessSizes = [
  { id: "solo", label: uiTranslations.sizes.solo },
  { id: "2_5", label: uiTranslations.sizes["2_5"] },
  { id: "6_20", label: uiTranslations.sizes["6_20"] },
  { id: "20_plus", label: uiTranslations.sizes["20_plus"] },
] as const;

export const businessPains = [
  { id: "leads", label: uiTranslations.pains.leads, description: "יותר לידים ומעקב אחרי מתעניינים", modules: ["crm", "whatsapp"] },
  { id: "invoices", label: uiTranslations.pains.invoices, description: "חשבוניות וקבלות מסודרות", modules: ["invoices", "documents"] },
  { id: "collections", label: uiTranslations.pains.collections, description: "גבייה ותזכורות תשלום", modules: ["collections", "invoices", "whatsapp"] },
  { id: "customer_service", label: uiTranslations.pains.customer_service, description: "שירות לקוחות והודעות", modules: ["crm", "whatsapp", "tasks"] },
  { id: "whatsapp", label: uiTranslations.pains.whatsapp, description: "ניהול הודעות ותזכורות", modules: ["whatsapp", "crm"] },
  { id: "tasks", label: uiTranslations.pains.tasks, description: "משימות, פולואפים ותפעול", modules: ["tasks", "employees"] },
  { id: "documents", label: uiTranslations.pains.documents, description: "מסמכים, דרייב וקבצים", modules: ["documents", "tasks"] },
] as const;

export const businessTypes = [
  { id: "beauty_clinic", label: uiTranslations.businessTypes.beauty_clinic, modules: ["crm", "invoices", "tasks", "whatsapp", "meetings", "collections"] },
  { id: "accountant", label: uiTranslations.businessTypes.accountant, modules: ["crm", "invoices", "supplier_management", "tasks", "documents", "meetings"] },
  { id: "lawyer", label: uiTranslations.businessTypes.lawyer, modules: ["crm", "invoices", "tasks", "documents", "meetings", "collections"] },
  { id: "insurance_agency", label: uiTranslations.businessTypes.insurance_agency, modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "collections"] },
  { id: "real_estate", label: uiTranslations.businessTypes.real_estate, modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings"] },
  { id: "ecommerce", label: uiTranslations.businessTypes.ecommerce, modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "collections", "employees"] },
  { id: "importer", label: uiTranslations.businessTypes.importer, modules: ["crm", "invoices", "supplier_management", "tasks", "documents", "collections", "employees"] },
  { id: "service_business", label: uiTranslations.businessTypes.service_business, modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections"] },
  { id: "marketing_agency", label: uiTranslations.businessTypes.marketing_agency, modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "employees"] },
  { id: "restaurant", label: uiTranslations.businessTypes.restaurant, modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "employees"] },
  { id: "other", label: uiTranslations.businessTypes.other, modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections"] },
] as const;

export type BusinessModuleId = (typeof businessModules)[number]["id"];
export type BusinessTypeId = (typeof businessTypes)[number]["id"];
export type BusinessSizeId = (typeof businessSizes)[number]["id"];
export type BusinessPainId = (typeof businessPains)[number]["id"];
export type DashboardKpiMetric = "clients" | "moneyToReceive" | "moneyToPay" | "openTasks" | "businessHealthScore" | "totalInvoices" | "unpaidPayments" | "supplierPaymentsCount";
export type BusinessDashboardWidget = { id: string; title: string; description: string; module: BusinessModuleId; metric: DashboardKpiMetric };
export type BusinessKpiConfig = { id: string; label: string; detail: string; metric: DashboardKpiMetric; module?: BusinessModuleId; format?: "currency" | "score" | "number" };
export type BusinessCrmField = { key: "name" | "company" | "phone" | "email" | "estimatedValue" | "tags" | "notes"; label: string; placeholder: string };
export type BusinessProfile = {
  title: string;
  subtitle: string;
  modules: BusinessModuleId[];
  dashboardWidgets: BusinessDashboardWidget[];
  dashboardKpis: BusinessKpiConfig[];
  crmFields: BusinessCrmField[];
};

const defaultCrmFields: BusinessCrmField[] = [
  { key: "name", label: "שם לקוח / ליד", placeholder: "שם מלא" },
  { key: "company", label: "חברה", placeholder: "שם חברה או עסק" },
  { key: "phone", label: "טלפון", placeholder: "+972..." },
  { key: "email", label: "מייל", placeholder: "client@example.com" },
  { key: "estimatedValue", label: "ערך עסקה", placeholder: "0" },
  { key: "tags", label: "תגיות", placeholder: "דחוף, המלצה, לקוח חשוב" },
  { key: "notes", label: "הערות", placeholder: "צרכים, סטטוס או הקשר חשוב" },
];

const baseKpis: BusinessKpiConfig[] = [
  { id: "clients", label: "לקוחות", detail: "לקוחות ולידים פעילים", metric: "clients", module: "crm" },
  { id: "receivable", label: "כסף לקבל", detail: "הכנסות צפויות", metric: "moneyToReceive", module: "invoices", format: "currency" },
  { id: "payable", label: "כסף לשלם", detail: "תשלומי ספקים פתוחים", metric: "moneyToPay", module: "supplier_management", format: "currency" },
  { id: "health", label: "בריאות עסקית", detail: "מדד פעילות כולל", metric: "businessHealthScore", format: "score" },
];

export const businessProfiles: Record<BusinessTypeId, BusinessProfile> = {
  beauty_clinic: {
    title: "מרכז צמיחה לקליניקה",
    subtitle: "לידים, תורים, וואטסאפ וגבייה למרפאת יופי.",
    modules: ["crm", "invoices", "tasks", "whatsapp", "meetings", "collections"],
    dashboardKpis: [
      { id: "leads", label: "מתעניינות", detail: "לידים ומטופלות במעקב", metric: "clients", module: "crm" },
      { id: "collections", label: "גבייה פתוחה", detail: "תשלומים שצריך לסגור", metric: "moneyToReceive", module: "collections", format: "currency" },
      { id: "tasks", label: "פולואפים", detail: "משימות ותזכורות טיפול", metric: "openTasks", module: "tasks" },
      { id: "health", label: "בריאות קליניקה", detail: "מדד פעילות כולל", metric: "businessHealthScore", format: "score" },
    ],
    dashboardWidgets: [
      { id: "new-consults", title: "פניות חדשות", description: "מעקב אחרי מתעניינות, מקור הפנייה והשלב הבא.", module: "crm", metric: "clients" },
      { id: "treatment-followups", title: "פולואפים לטיפולים", description: "משימות ותזכורות אחרי ייעוץ או טיפול.", module: "tasks", metric: "openTasks" },
      { id: "whatsapp-reminders", title: "תזכורות וואטסאפ", description: "הודעות ותזכורות ללקוחות לפני תור או תשלום.", module: "whatsapp", metric: "clients" },
    ],
    crmFields: [
      { key: "name", label: "שם מטופלת / מתעניינת", placeholder: "שם מלא" },
      { key: "company", label: "טיפול מעניין", placeholder: "לייזר, הזרקות, פנים..." },
      { key: "phone", label: "טלפון / וואטסאפ", placeholder: "+972..." },
      { key: "email", label: "מייל", placeholder: "אופציונלי" },
      { key: "estimatedValue", label: "שווי טיפול צפוי", placeholder: "עלות טיפול משוערת" },
      { key: "tags", label: "תגיות קליניקה", placeholder: "ייעוץ, חוזרת, לקוחה חשובה" },
      { key: "notes", label: "העדפות ורגישויות", placeholder: "טיפול מבוקש, זמינות, הערות" },
    ],
  },
  accountant: {
    title: "מרכז תפעול למשרד רואה חשבון",
    subtitle: "לקוחות, מסמכים, חשבוניות ומשימות דיווח.",
    modules: ["crm", "invoices", "supplier_management", "tasks", "documents", "meetings"],
    dashboardKpis: [
      { id: "clients", label: "לקוחות משרד", detail: "לקוחות פעילים במעקב", metric: "clients", module: "crm" },
      { id: "documents", label: "חשבוניות", detail: "מסמכים שנקלטו", metric: "totalInvoices", module: "invoices" },
      { id: "tasks", label: "משימות דיווח", detail: "משימות פתוחות", metric: "openTasks", module: "tasks" },
      { id: "health", label: "סדר תפעולי", detail: "מדד פעילות כולל", metric: "businessHealthScore", format: "score" },
    ],
    dashboardWidgets: [
      { id: "client-docs", title: "מסמכי לקוחות", description: "חשבוניות, קבלות וקבצים שדורשים טיפול.", module: "documents", metric: "totalInvoices" },
      { id: "reporting-tasks", title: "משימות דיווח", description: "מעקב אחרי דוחות, חסרים ופניות ללקוח.", module: "tasks", metric: "openTasks" },
      { id: "supplier-review", title: "בדיקת ספקים", description: "תשלומי ספקים וחשבוניות חסרות לבדיקה.", module: "supplier_management", metric: "supplierPaymentsCount" },
    ],
    crmFields: [
      { key: "name", label: "שם לקוח", placeholder: "שם העסק או האדם" },
      { key: "company", label: "ישות / חברה", placeholder: "חברה בע״מ, עוסק מורשה..." },
      { key: "phone", label: "טלפון איש קשר", placeholder: "+972..." },
      { key: "email", label: "מייל למסמכים", placeholder: "finance@example.com" },
      { key: "estimatedValue", label: "שווי תיק חודשי", placeholder: "ריטיינר משוער" },
      { key: "tags", label: "סוג תיק", placeholder: "חודשי, שנתי, שכר, הצהרת הון" },
      { key: "notes", label: "חוסרים והנחיות", placeholder: "מסמכים חסרים, מועדי דיווח" },
    ],
  },
  lawyer: {
    title: "לוח ניהול למשרד עורכי דין",
    subtitle: "תיקים, לקוחות, מסמכים, פגישות וגבייה.",
    modules: ["crm", "invoices", "tasks", "documents", "meetings", "collections"],
    dashboardKpis: baseKpis,
    dashboardWidgets: [
      { id: "case-intake", title: "קליטת תיקים", description: "פניות חדשות, תחום משפטי וסטטוס טיפול.", module: "crm", metric: "clients" },
      { id: "legal-docs", title: "מסמכי תיק", description: "קבצים, חוזים וחומרים שדורשים סדר.", module: "documents", metric: "totalInvoices" },
      { id: "legal-collections", title: "גבייה לפי תיק", description: "חיובים פתוחים ותשלומים שצריך לגבות.", module: "collections", metric: "moneyToReceive" },
    ],
    crmFields: [
      { key: "name", label: "שם לקוח / פונה", placeholder: "שם מלא" },
      { key: "company", label: "תחום / סוג תיק", placeholder: "מקרקעין, משפחה, מסחרי..." },
      { key: "phone", label: "טלפון", placeholder: "+972..." },
      { key: "email", label: "מייל", placeholder: "client@example.com" },
      { key: "estimatedValue", label: "שווי תיק משוער", placeholder: "שכר טרחה צפוי" },
      { key: "tags", label: "תגיות תיק", placeholder: "דחוף, חוזה, דיון" },
      { key: "notes", label: "פרטי מקרה", placeholder: "רקע, דדליין, מסמכים חסרים" },
    ],
  },
  insurance_agency: {
    title: "מרכז ניהול לסוכנות ביטוח",
    subtitle: "לידים, חידושים, פוליסות ושירות לקוחות.",
    modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "collections"],
    dashboardKpis: baseKpis,
    dashboardWidgets: [
      { id: "renewals", title: "חידושי פוליסות", description: "לקוחות שדורשים חידוש, הצעה או תזכורת.", module: "tasks", metric: "openTasks" },
      { id: "policy-docs", title: "מסמכי פוליסה", description: "מסמכים וקבצים לכל לקוח.", module: "documents", metric: "totalInvoices" },
      { id: "service-whatsapp", title: "שירות בוואטסאפ", description: "שיחות ותשובות ללקוחות.", module: "whatsapp", metric: "clients" },
    ],
    crmFields: [
      { key: "name", label: "שם מבוטח / ליד", placeholder: "שם מלא" },
      { key: "company", label: "סוג ביטוח", placeholder: "רכב, דירה, בריאות, עסק" },
      { key: "phone", label: "טלפון", placeholder: "+972..." },
      { key: "email", label: "מייל", placeholder: "client@example.com" },
      { key: "estimatedValue", label: "פרמיה צפויה", placeholder: "סכום שנתי / חודשי" },
      { key: "tags", label: "תגיות ביטוח", placeholder: "חידוש, תביעה, הצעה" },
      { key: "notes", label: "פרטי פוליסה", placeholder: "תאריך חידוש, כיסוי, הערות" },
    ],
  },
  real_estate: {
    title: "חדר עסקאות נדל״ן",
    subtitle: "נכסים, קונים, מוכרים, פגישות ומסמכים.",
    modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings"],
    dashboardKpis: [
      { id: "prospects", label: "קונים/מוכרים", detail: "אנשי קשר פעילים", metric: "clients", module: "crm" },
      { id: "pipeline", label: "שווי עסקאות", detail: "תהליך מכירה נדל״ני", metric: "moneyToReceive", module: "invoices", format: "currency" },
      { id: "showings", label: "סיורים ופולואפים", detail: "משימות פתוחות", metric: "openTasks", module: "tasks" },
      { id: "health", label: "קצב עסקאות", detail: "מדד פעילות כולל", metric: "businessHealthScore", format: "score" },
    ],
    dashboardWidgets: [
      { id: "property-leads", title: "לידים לנכסים", description: "קונים, מוכרים ומשקיעים לפי מקור ושלב.", module: "crm", metric: "clients" },
      { id: "showing-tasks", title: "סיורים ותזכורות", description: "פגישות, ביקורים ופולואפים.", module: "meetings", metric: "openTasks" },
      { id: "deal-docs", title: "מסמכי עסקה", description: "חוזים, נסחים וקבצים לכל עסקה.", module: "documents", metric: "totalInvoices" },
    ],
    crmFields: [
      { key: "name", label: "שם קונה / מוכר", placeholder: "שם מלא" },
      { key: "company", label: "נכס / אזור", placeholder: "עיר, שכונה או כתובת" },
      { key: "phone", label: "טלפון", placeholder: "+972..." },
      { key: "email", label: "מייל", placeholder: "client@example.com" },
      { key: "estimatedValue", label: "שווי עסקה", placeholder: "מחיר נכס משוער" },
      { key: "tags", label: "תגיות נדל״ן", placeholder: "קונה, מוכר, משקיע, דחוף" },
      { key: "notes", label: "דרישות נכס", placeholder: "תקציב, אזור, חדרים, דדליין" },
    ],
  },
  ecommerce: {
    title: "מרכז תפעול לחנות אונליין",
    subtitle: "הזמנות, ספקים, גבייה, שירות וצוות.",
    modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "collections", "employees"],
    dashboardKpis: baseKpis,
    dashboardWidgets: [
      { id: "orders", title: "לקוחות והזמנות", description: "לקוחות, פניות ושירות אחרי רכישה.", module: "crm", metric: "clients" },
      { id: "supplier-payments", title: "ספקים ומלאי", description: "תשלומי ספקים וחשבוניות חסרות.", module: "supplier_management", metric: "moneyToPay" },
      { id: "support", title: "שירות לקוחות", description: "וואטסאפ ומשימות טיפול פתוחות.", module: "whatsapp", metric: "openTasks" },
    ],
    crmFields: [
      { key: "name", label: "שם לקוח", placeholder: "שם מלא" },
      { key: "company", label: "מוצר / הזמנה", placeholder: "מוצר, קטגוריה או מספר הזמנה" },
      { key: "phone", label: "טלפון", placeholder: "+972..." },
      { key: "email", label: "מייל", placeholder: "customer@example.com" },
      { key: "estimatedValue", label: "שווי הזמנה", placeholder: "סכום הזמנה" },
      { key: "tags", label: "תגיות מסחר", placeholder: "החזרה, לקוח חשוב, משלוח, תלונה" },
      { key: "notes", label: "פרטי שירות", placeholder: "בעיה, משלוח, בקשה מיוחדת" },
    ],
  },
  importer: {
    title: "מרכז שליטה ליבואן",
    subtitle: "ספקים, מסמכים, תשלומים, משימות וצוות.",
    modules: ["crm", "invoices", "supplier_management", "tasks", "documents", "collections", "employees"],
    dashboardKpis: baseKpis,
    dashboardWidgets: [
      { id: "supplier-exposure", title: "ספקים ותשלומים", description: "תשלומים פתוחים, חסרים וסכומים חריגים.", module: "supplier_management", metric: "moneyToPay" },
      { id: "shipment-docs", title: "מסמכי יבוא", description: "חשבוניות, מסמכי שילוח וקבצים.", module: "documents", metric: "totalInvoices" },
      { id: "ops-tasks", title: "משימות תפעול", description: "מעקב אחרי פעולות וצוות.", module: "tasks", metric: "openTasks" },
    ],
    crmFields: [
      { key: "name", label: "שם ספק / לקוח", placeholder: "שם חברה" },
      { key: "company", label: "מדינה / קטגוריה", placeholder: "סין, טורקיה, מוצר..." },
      { key: "phone", label: "טלפון", placeholder: "+972..." },
      { key: "email", label: "מייל מסחרי", placeholder: "supplier@example.com" },
      { key: "estimatedValue", label: "שווי עסקה / משלוח", placeholder: "עלות צפויה" },
      { key: "tags", label: "תגיות יבוא", placeholder: "משלוח, מכס, ספק חדש" },
      { key: "notes", label: "פרטי משלוח", placeholder: "ETA, מסמכים חסרים, תנאי תשלום" },
    ],
  },
  service_business: {
    title: "מרכז ניהול לעסק שירותים",
    subtitle: "לקוחות, חשבוניות, ספקים, משימות וגבייה.",
    modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections"],
    dashboardKpis: baseKpis,
    dashboardWidgets: [
      { id: "client-work", title: "לקוחות פעילים", description: "לקוחות, עבודה פתוחה וסטטוס טיפול.", module: "crm", metric: "clients" },
      { id: "cashflow", title: "תזרים", description: "כסף לקבל וכסף לשלם.", module: "invoices", metric: "moneyToReceive" },
      { id: "tasks", title: "משימות שירות", description: "פולואפים, תפעול ותזכורות.", module: "tasks", metric: "openTasks" },
    ],
    crmFields: defaultCrmFields,
  },
  marketing_agency: {
    title: "מרכז ביצוע לסוכנות שיווק",
    subtitle: "לקוחות, קמפיינים, משימות, פגישות וצוות.",
    modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "employees"],
    dashboardKpis: [
      { id: "clients", label: "לקוחות וקמפיינים", detail: "לקוחות פעילים", metric: "clients", module: "crm" },
      { id: "revenue", label: "ריטיינרים לקבל", detail: "הכנסות צפויות", metric: "moneyToReceive", module: "invoices", format: "currency" },
      { id: "delivery", label: "משימות דליברי", detail: "משימות פתוחות", metric: "openTasks", module: "tasks" },
      { id: "health", label: "בריאות לקוחות", detail: "מדד פעילות כולל", metric: "businessHealthScore", format: "score" },
    ],
    dashboardWidgets: [
      { id: "campaigns", title: "קמפיינים ולקוחות", description: "לידים, לקוחות ושלבי עבודה.", module: "crm", metric: "clients" },
      { id: "delivery", title: "דליברי ומשימות", description: "משימות צוות ותוצרים פתוחים.", module: "tasks", metric: "openTasks" },
      { id: "meetings", title: "פגישות לקוח", description: "פגישות, סיכומים ופולואפים.", module: "meetings", metric: "clients" },
    ],
    crmFields: [
      { key: "name", label: "שם לקוח / ליד", placeholder: "שם איש קשר" },
      { key: "company", label: "מותג / קמפיין", placeholder: "שם מותג או קמפיין" },
      { key: "phone", label: "טלפון", placeholder: "+972..." },
      { key: "email", label: "מייל", placeholder: "client@example.com" },
      { key: "estimatedValue", label: "ריטיינר צפוי", placeholder: "סכום חודשי" },
      { key: "tags", label: "תגיות סוכנות", placeholder: "קידום, פרסום, סושיאל, דחוף" },
      { key: "notes", label: "בריף ויעדים", placeholder: "מטרות, תקציב, ערוצים" },
    ],
  },
  restaurant: {
    title: "לוח תפעול למסעדה",
    subtitle: "ספקים, צוות, וואטסאפ, חשבוניות ומשימות.",
    modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "employees"],
    dashboardKpis: [
      { id: "customers", label: "לקוחות / אירועים", detail: "אנשי קשר והזמנות", metric: "clients", module: "crm" },
      { id: "supplier", label: "ספקים לשלם", detail: "תשלומי ספקים פתוחים", metric: "moneyToPay", module: "supplier_management", format: "currency" },
      { id: "tasks", label: "משימות תפעול", detail: "משימות פתוחות", metric: "openTasks", module: "tasks" },
      { id: "health", label: "בריאות תפעולית", detail: "מדד פעילות כולל", metric: "businessHealthScore", format: "score" },
    ],
    dashboardWidgets: [
      { id: "supplier-invoices", title: "חשבוניות ספקים", description: "מזון, שתייה וספקים פתוחים.", module: "supplier_management", metric: "moneyToPay" },
      { id: "staff-tasks", title: "משימות צוות", description: "תפעול, משמרות ופולואפים.", module: "employees", metric: "openTasks" },
      { id: "whatsapp-orders", title: "וואטסאפ לקוחות", description: "אירועים, הזמנות ושירות לקוחות.", module: "whatsapp", metric: "clients" },
    ],
    crmFields: [
      { key: "name", label: "שם לקוח / ספק", placeholder: "שם מלא או עסק" },
      { key: "company", label: "אירוע / קטגוריה", placeholder: "אירוע, קייטרינג, ספק ירקות..." },
      { key: "phone", label: "טלפון", placeholder: "+972..." },
      { key: "email", label: "מייל", placeholder: "אופציונלי" },
      { key: "estimatedValue", label: "שווי הזמנה", placeholder: "סכום משוער" },
      { key: "tags", label: "תגיות מסעדה", placeholder: "אירוע, ספק, לקוח חשוב, תלונה" },
      { key: "notes", label: "פרטים תפעוליים", placeholder: "תאריך, כמות, בקשות מיוחדות" },
    ],
  },
  other: {
    title: "מרכז ניהול עסקי",
    subtitle: "מודולים כלליים לניהול עסק.",
    modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections"],
    dashboardKpis: baseKpis,
    dashboardWidgets: [
      { id: "clients", title: "לקוחות", description: "לקוחות, לידים ופעילות אחרונה.", module: "crm", metric: "clients" },
      { id: "finance", title: "כספים", description: "חשבוניות, גבייה ותשלומי ספקים.", module: "invoices", metric: "moneyToReceive" },
      { id: "tasks", title: "משימות", description: "משימות ותזכורות פתוחות.", module: "tasks", metric: "openTasks" },
    ],
    crmFields: defaultCrmFields,
  },
};

export type OrganizationSettings = {
  id: string;
  name: string;
  businessName: string | null;
  businessType: BusinessTypeId;
  businessSize: BusinessSizeId | null;
  mainBusinessPain: BusinessPainId | null;
  enabledModules: BusinessModuleId[];
  onboardingCompleted: boolean;
  onboardingRequired: boolean;
  recommendedModules: BusinessModuleId[];
  businessProfile?: BusinessProfile;
  locale: string;
  currency: string;
  timezone: string;
};

export type BusinessTemplatesResponse = {
  businessTypes: typeof businessTypes;
  businessProfiles: Record<BusinessTypeId, BusinessProfile>;
  businessSizes: typeof businessSizes;
  businessPains: typeof businessPains;
  modules: typeof businessModules;
  defaultBusinessType: BusinessTypeId;
  defaultEnabledModules: BusinessModuleId[];
};

export const defaultEnabledModules = businessTypes.find((type) => type.id === "service_business")!.modules as readonly BusinessModuleId[];

export function normalizeBusinessTypeId(businessType: unknown): BusinessTypeId {
  if (businessType === "service_company") return "service_business";
  if (businessType === "insurance_agent") return "insurance_agency";
  return typeof businessType === "string" && businessType in businessProfiles
    ? businessType as BusinessTypeId
    : "service_business";
}

export function normalizeEnabledModules(enabledModules: unknown, businessType?: unknown): BusinessModuleId[] {
  const profile = getBusinessProfile(businessType);
  if (!Array.isArray(enabledModules)) return [...profile.modules];
  const allowed = new Set<BusinessModuleId>(profile.modules);
  const normalized = enabledModules.filter((moduleId): moduleId is BusinessModuleId =>
    typeof moduleId === "string" && allowed.has(moduleId as BusinessModuleId)
  );
  return normalized.length ? Array.from(new Set(normalized)) : [...profile.modules];
}

export function getBusinessProfile(businessType: unknown): BusinessProfile {
  return businessProfiles[normalizeBusinessTypeId(businessType)] ?? businessProfiles.service_business;
}

export function recommendedModulesFor(
  businessType: unknown,
  businessSize: unknown,
  mainBusinessPain: unknown
) {
  const template = getBusinessProfile(businessType);
  const painModules = businessPains.find((pain) => pain.id === mainBusinessPain)?.modules ?? [];
  const sizeModules = businessSize === "6_20" || businessSize === "20_plus" ? ["employees"] : [];
  const relevant = new Set<BusinessModuleId>(template.modules);
  return Array.from(new Set([...template.modules, ...painModules, ...sizeModules]))
    .filter((moduleId): moduleId is BusinessModuleId => relevant.has(moduleId as BusinessModuleId));
}

export function moduleEnabled(settings: OrganizationSettings | null, moduleId: BusinessModuleId) {
  return !settings || normalizeEnabledModules(settings.enabledModules, settings.businessType).includes(moduleId);
}

export function businessTypeLabel(type: string | null | undefined) {
  return businessTypes.find((item) => item.id === normalizeBusinessTypeId(type))?.label ?? uiTranslations.businessTypes.service_business;
}
