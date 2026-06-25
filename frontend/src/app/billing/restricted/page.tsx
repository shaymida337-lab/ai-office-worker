"use client";

import {
  BillingRouteGuard,
  InlineErrorCard,
  LoadingSkeleton,
  useBilling,
} from "@/components/billing";
import {
  BillingAccessPanels,
  BillingCTAGroup,
  BillingHero,
  BillingPageShell,
  BillingPrimaryLink,
  BillingSecondaryLink,
} from "@/components/billing/ui";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingRestrictedPage() {
  const { loading, error } = useBilling();

  return (
    <BillingRouteGuard allowedStates={["restricted", "paused", "cancelled"]}>
      <BillingPageShell tone="warm">
        {loading && <LoadingSkeleton />}
        {!!error && <InlineErrorCard message={error} />}

        {!loading && !error && (
          <div className="grid gap-10">
            <BillingHero
              headline="נטלי ממתינה לחזור לעבוד איתך"
              subheadline="המידע שלך שמור. אפשר לצפות בנתונים קיימים, וכשתרצה להחזיר את נטלי לעבודה — זה ייקח רגע."
            />

            <BillingAccessPanels
              availableItems={["צפייה בחשבוניות ותשלומים", "צפייה בדוחות היסטוריים", "גישה לרשומות קיימות"]}
              lockedItems={["יצירת פריטים חדשים", "עריכת נתונים קיימים", "פעולות אוטומציה חדשות"]}
            />

            <BillingCTAGroup
              primary={<BillingPrimaryLink href={BILLING_ROUTES.reactivate}>הפעלת מנוי מחדש</BillingPrimaryLink>}
              secondary={<BillingSecondaryLink href="/dashboard">צפייה בנתונים</BillingSecondaryLink>}
            />
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
