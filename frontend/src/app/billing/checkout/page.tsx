import { BillingScreen } from "@/components/billing";

export default function BillingCheckoutPage() {
  return (
    <BillingScreen
      title="Checkout"
      description="Placeholder בלבד. אין אינטגרציית תשלום בספרינט 1.1."
      allowedStates={["trial", "trial_ending", "past_due", "cancelled", "restricted", "paused"]}
      showPlanCards
    />
  );
}
