import { BillingScreen } from "@/components/billing";

export default function BillingValueReportPage() {
  return (
    <BillingScreen
      title="דוח ערך אישי"
      description="מסך דוח ערך אישי (Placeholder). ללא לוגיקת KPI אמיתית בספרינט 1.1."
      allowedStates={["trial", "trial_ending"]}
    />
  );
}
