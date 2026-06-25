import { BillingScreen } from "@/components/billing";

export default function BillingManagePage() {
  return (
    <BillingScreen
      title="ניהול מנוי"
      description="מסך ניהול מנוי (Pause/Cancel) כתשתית. ללא פעולות mutation בספרינט 1.1."
      allowedStates={["active", "reactivated"]}
    />
  );
}
