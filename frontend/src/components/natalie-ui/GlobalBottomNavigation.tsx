"use client";

import { useGlobalBottomNav } from "@/hooks/useGlobalBottomNav";
import { BottomNavigation } from "./BottomNavigation";

export function GlobalBottomNavigation() {
  const items = useGlobalBottomNav();
  return <BottomNavigation items={items} />;
}
