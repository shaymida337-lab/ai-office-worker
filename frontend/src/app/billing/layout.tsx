"use client";

import { Nav } from "@/components/Nav";
import { BillingLayout, BillingProvider } from "@/components/billing";

export default function BillingRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <BillingProvider>
      <Nav />
      <BillingLayout>{children}</BillingLayout>
    </BillingProvider>
  );
}
