export function PlanCard({
  name,
  price,
  highlighted = false,
}: {
  name: string;
  price: string;
  highlighted?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-4 ${highlighted ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}
    >
      <h3 className="text-base font-bold text-slate-900">{name}</h3>
      <p className="mt-1 text-sm text-slate-600">{price}</p>
    </article>
  );
}
