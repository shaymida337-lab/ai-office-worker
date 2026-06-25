import { BillingScreen } from "@/components/billing";

export default function BillingSuccessPage() {
  return (
    <BillingScreen
      title="תשלום הצליח"
      description="מסך הצלחה בסיסי לזרימה. ללא חיבור לספק תשלומים."
      allowedStates={["active", "reactivated"]}
    />
  );
}
