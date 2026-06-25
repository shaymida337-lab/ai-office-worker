import { BillingScreen } from "@/components/billing";

export default function BillingPlansPage() {
  return (
    <BillingScreen
      title="בחירת מסלול"
      description="מסך בחירת מסלול עם רכיבי תוכנית לשימוש חוזר. ללא תמחור/רכישה בפועל."
      allowedStates={["trial", "trial_ending", "restricted", "cancelled", "past_due", "paused"]}
      showPlanCards
    />
  );
}
