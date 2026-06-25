import { BillingScreen } from "@/components/billing";

export default function BillingPaymentMethodPage() {
  return (
    <BillingScreen
      title="עדכון אמצעי תשלום"
      description="Placeholder תשתיתי בלבד. ללא עדכון אמצעי תשלום אמיתי בספרינט 1.1."
      allowedStates={["active", "past_due", "reactivated"]}
    />
  );
}
