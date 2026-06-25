import { BillingScreen } from "@/components/billing";

export default function BillingFailedPage() {
  return (
    <BillingScreen
      title="תשלום נכשל"
      description="מסך כשל תשלום בסיסי ל-route guard. ללא Retry או סליקה בפועל בספרינט 1.1."
      allowedStates={["past_due"]}
    />
  );
}
