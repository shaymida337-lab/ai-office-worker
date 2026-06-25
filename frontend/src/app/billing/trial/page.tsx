import { BillingScreen } from "@/components/billing";

export default function BillingTrialPage() {
  return (
    <BillingScreen
      title="תקופת ניסיון פעילה"
      description="מסך בסיס לספרינט 1.1. בספרינט זה יש תשתית בלבד ללא סליקה."
      allowedStates={["trial"]}
    />
  );
}
