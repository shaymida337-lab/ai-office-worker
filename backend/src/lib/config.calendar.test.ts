import test from "node:test";
import assert from "node:assert/strict";

import { config } from "./config.js";

test("calendar engine feature flags default to false", () => {
  assert.equal(config.calendarEngine.v1Read, process.env.CALENDAR_ENGINE_V1_READ?.toLowerCase() === "true");
  assert.equal(config.calendarEngine.v1Write, process.env.CALENDAR_ENGINE_V1_WRITE?.toLowerCase() === "true");
});
