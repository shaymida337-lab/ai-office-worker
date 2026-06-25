import { BillingScreen } from "@/components/billing";

export default function BillingSubscriptionPage() {
  return (
    <BillingScreen
      title="מנוי פעיל"
      description="מסך מצב מנוי פעיל. תשתית סטטית בלבד בספרינט 1.1."
      allowedStates={["active", "reactivated"]}
    />
  );
}
