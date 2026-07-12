import { LANDING_COMPARISON } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

export function LandingComparisonSection() {
  return (
    <section className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16" aria-label="השוואה — עובדת משרד רגילה מול נטלי">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <p className="page-kicker">{LANDING_COMPARISON.kicker}</p>
          <h2 className={`${typography.h2} mb-3`} style={{ color: colors.textPrimary }}>
            {LANDING_COMPARISON.title}
          </h2>
        </div>

        <div
          className={`${radius.card} border ${shadow.soft} overflow-x-auto`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
        >
          <table className="w-full min-w-[520px] border-collapse text-right">
            <thead>
              <tr style={{ backgroundColor: colors.accentMuted }}>
                <th className="px-4 py-3.5 text-sm font-bold sm:px-5" style={{ color: colors.textSecondary }}>
                  &nbsp;
                </th>
                <th className="px-4 py-3.5 text-sm font-bold sm:px-5" style={{ color: colors.textSecondary }}>
                  {LANDING_COMPARISON.columns.human}
                </th>
                <th className="px-4 py-3.5 text-sm font-extrabold sm:px-5" style={{ color: colors.accent }}>
                  {LANDING_COMPARISON.columns.natalie}
                </th>
              </tr>
            </thead>
            <tbody>
              {LANDING_COMPARISON.rows.map((row, index) => (
                <tr
                  key={row.label}
                  className="border-t"
                  style={{
                    borderColor: colors.borderSubtle,
                    backgroundColor: index % 2 === 1 ? colors.accentMuted : undefined,
                  }}
                >
                  <td className="px-4 py-3.5 text-sm font-bold sm:px-5" style={{ color: colors.textPrimary }}>
                    {row.label}
                  </td>
                  <td className="px-4 py-3.5 text-sm font-medium sm:px-5" style={{ color: colors.textSecondary }}>
                    {row.human}
                  </td>
                  <td className="px-4 py-3.5 text-sm font-bold sm:px-5" style={{ color: colors.textPrimary }}>
                    {row.natalie}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
