import { BillingScreen } from "@/components/billing";

export default function BillingRestrictedPage() {
  return (
    <BillingScreen
      title="מצב קריאה בלבד"
      description="מסך נעילה במצבים restricted/paused/cancelled. בסיס ניווט לספרינט 1.1."
      allowedStates={["restricted", "paused", "cancelled"]}
    />
  );
}
