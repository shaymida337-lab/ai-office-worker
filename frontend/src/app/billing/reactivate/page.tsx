import { BillingScreen } from "@/components/billing";

export default function BillingReactivatePage() {
  return (
    <BillingScreen
      title="הפעלה מחדש"
      description="מסך Reactivation כתשתית בלבד. אין סליקה או mutation בספרינט 1.1."
      allowedStates={["restricted", "paused", "cancelled", "past_due"]}
      showPlanCards
    />
  );
}
