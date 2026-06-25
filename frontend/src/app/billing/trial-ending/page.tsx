import { BillingScreen } from "@/components/billing";

export default function BillingTrialEndingPage() {
  return (
    <BillingScreen
      title="תקופת ניסיון מסתיימת"
      description="מסך תזכורת סיום ניסיון. תשתית בלבד בספרינט 1.1."
      allowedStates={["trial_ending"]}
    />
  );
}
