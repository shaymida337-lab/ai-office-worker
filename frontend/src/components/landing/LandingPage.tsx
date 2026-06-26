import { PublicSiteFooter } from "@/components/trust";
import { LandingFaqSection } from "./LandingFaq";
import { LandingHeader } from "./LandingHeader";
import { LandingHero } from "./LandingHero";
import {
  LandingFeaturesSection,
  LandingHowItWorksSection,
  LandingIntegrationsStrip,
} from "./LandingSections";
import { LandingWaitlistSection } from "./LandingWaitlist";

export function LandingPage() {
  return (
    <div className="flex min-h-[100svh] min-h-[100dvh] w-full min-w-0 flex-col overflow-x-hidden">
      <LandingHeader />
      <main id="main" className="min-w-0 flex-1">
        <LandingHero />
        <LandingIntegrationsStrip />
        <LandingFeaturesSection />
        <LandingHowItWorksSection />
        <LandingFaqSection />
        <LandingWaitlistSection />
      </main>
      <PublicSiteFooter variant="light" />
    </div>
  );
}
