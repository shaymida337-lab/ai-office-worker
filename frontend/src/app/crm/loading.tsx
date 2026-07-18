/** Instant CRM shell while the route chunk mounts (Next.js navigation). */
export default function CrmLoading() {
  return (
    <div dir="rtl" data-testid="crm-shell" data-crm-has-data="false">
      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-6">
        <h1 className="text-2xl font-black text-[#0F172A]">ניהול לקוחות</h1>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="h-20 animate-pulse rounded-2xl bg-[#E8EEF8]" />
          <div className="h-20 animate-pulse rounded-2xl bg-[#E8EEF8]" />
          <div className="h-20 animate-pulse rounded-2xl bg-[#E8EEF8]" />
          <div className="h-20 animate-pulse rounded-2xl bg-[#E8EEF8]" />
        </div>
        <div className="h-28 animate-pulse rounded-2xl bg-[#E8EEF8]" />
        <div className="h-28 animate-pulse rounded-2xl bg-[#E8EEF8]" />
      </div>
    </div>
  );
}
