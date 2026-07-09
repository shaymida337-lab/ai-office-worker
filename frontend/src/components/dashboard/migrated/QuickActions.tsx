"use client";

import { SectionCard } from "@/components/natalie-ui";
import { Button } from "@/components/natalie-ui";

type QuickActionItem = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export function QuickActions({
  title,
  items,
}: {
  title: string;
  items: QuickActionItem[];
}) {
  return (
    <SectionCard title={title}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            onClick={item.onClick}
            disabled={item.disabled}
            className="!min-h-10 w-full"
          >
            {item.label}
          </Button>
        ))}
      </div>
    </SectionCard>
  );
}
