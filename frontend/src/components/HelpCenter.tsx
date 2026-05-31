"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { getHelpContentForPath } from "@/config/helpContent";
import { HelpButton } from "@/components/HelpButton";
import { HelpPanel } from "@/components/HelpPanel";
import { WalkthroughOverlay } from "@/components/WalkthroughOverlay";

export function HelpCenter() {
  const pathname = usePathname();
  const [panelOpen, setPanelOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const content = useMemo(() => getHelpContentForPath(pathname), [pathname]);

  useEffect(() => {
    const openHelp = () => setPanelOpen(true);
    window.addEventListener("open-help-center", openHelp);
    return () => window.removeEventListener("open-help-center", openHelp);
  }, []);

  useEffect(() => {
    setPanelOpen(false);
    setWalkthroughOpen(false);
  }, [pathname]);

  return (
    <>
      <HelpButton onClick={() => setPanelOpen(true)} />
      <HelpPanel
        content={content}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onStartWalkthrough={() => {
          setPanelOpen(false);
          setWalkthroughOpen(true);
        }}
      />
      <WalkthroughOverlay
        pageKey={content.pageKey}
        steps={content.walkthroughSteps}
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
      />
    </>
  );
}
