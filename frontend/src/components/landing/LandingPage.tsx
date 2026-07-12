import { PublicSiteFooter } from "@/components/trust";
import { colors } from "@/lib/design-tokens";
import { LandingComparisonSection } from "./LandingComparison";
import { LandingDemoSection } from "./LandingDemo";
import { LandingFaqSection } from "./LandingFaq";
import { LandingFounderStorySection } from "./LandingFounderStory";
import { LandingHeader } from "./LandingHeader";
import { LandingHero } from "./LandingHero";
import { LandingPricingPreviewSection } from "./LandingPricingPreview";
import {
  LandingFeaturesSection,
  LandingHowItWorksSection,
  LandingIntegrationsStrip,
} from "./LandingSections";
import { LandingSocialProofSection } from "./LandingSocialProof";
import { LandingTrustSection } from "./LandingTrust";
import { LandingWaitlistSection } from "./LandingWaitlist";
import { StickyMobileCta } from "./StickyMobileCta";

export function LandingPage() {
  return (
    // עמוד השיווק תמיד בהיר — לא יורש את מצב ה-dark של האפליקציה
    // (בלי זה, כותרות בטוקנים כהים יושבות על רקע כהה ונעלמות).
    <div
      className="flex min-h-[100svh] min-h-[100dvh] w-full min-w-0 flex-col overflow-x-hidden"
      style={{ backgroundColor: colors.bg }}
    >
      <LandingHeader />
      <main id="main" className="min-w-0 flex-1">
        <LandingHero />
        <LandingDemoSection />
        <LandingHowItWorksSection />
        <LandingFeaturesSection />
        <LandingComparisonSection />
        <LandingIntegrationsStrip />
        <LandingTrustSection />
        <LandingFounderStorySection />
        <LandingSocialProofSection />
        <LandingPricingPreviewSection />
        <LandingFaqSection />
        <LandingWaitlistSection />
      </main>
      <StickyMobileCta />
      <PublicSiteFooter variant="light" />
    </div>
  );
}
