import { buildJourneyDatasetFromRegistry } from "../src/services/journeyReliability/journeyRegistry.js";
import { runJourneyReliabilityDryRun } from "../src/services/journeyReliability/journeyRunner.js";

const dataset = buildJourneyDatasetFromRegistry();
const implementedJourneys = dataset.journeys.filter(
  (journey) => !journey.scaffoldOnly && journey.implemented !== false,
);
const report = runJourneyReliabilityDryRun(
  { ...dataset, journeys: implementedJourneys },
  { mode: "dry_run", dryRun: true },
);
console.log(
  JSON.stringify(
    {
      releaseRecommendation: report.releaseRecommendation,
      results: report.results.map((r) => ({
        journeyId: r.journeyId,
        failures: r.failures,
        warnings: r.warnings,
      })),
    },
    null,
    2,
  ),
);
