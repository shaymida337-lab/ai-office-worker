"use client";

import { useEffect, useState } from "react";

export function useMaxVisibleAppointments(): number {
  const [maxVisible, setMaxVisible] = useState(3);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 639px)");
    const tabletQuery = window.matchMedia("(max-width: 1023px)");

    const update = () => {
      if (mobileQuery.matches) setMaxVisible(1);
      else if (tabletQuery.matches) setMaxVisible(2);
      else setMaxVisible(3);
    };

    update();
    mobileQuery.addEventListener("change", update);
    tabletQuery.addEventListener("change", update);
    return () => {
      mobileQuery.removeEventListener("change", update);
      tabletQuery.removeEventListener("change", update);
    };
  }, []);

  return maxVisible;
}
