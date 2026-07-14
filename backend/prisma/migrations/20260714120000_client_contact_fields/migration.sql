-- פרטי קשר בכרטיס לקוח: טלפון נפרד מ-WhatsApp וכתובת לניווט (Waze).
-- עמודות nullable — אין השפעה על רשומות קיימות.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "address" TEXT;
