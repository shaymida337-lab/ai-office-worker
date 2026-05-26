import { Logo } from "@/components/Logo";

export function AppSplash({ label = "טוען את סביבת העבודה...", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={compact ? "app-splash app-splash-compact" : "app-splash"}>
      <div className="app-splash-card">
        <Logo size="lg" showSubtitle />
        <div className="app-splash-spinner" aria-hidden="true" />
        <p>{label}</p>
      </div>
    </div>
  );
}
