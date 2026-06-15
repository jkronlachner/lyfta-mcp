/**
 * Live read smoke test. Requires a real LYFTA_API_KEY in env. Not run in CI.
 * Prints only status + counts — never the key or workout contents.
 *
 *   LYFTA_API_KEY=<real> npm run smoke
 */
import { LyftaClient } from "../src/lyfta-client.js";

const key = process.env.LYFTA_API_KEY;
if (!key) {
  console.error("set LYFTA_API_KEY");
  process.exit(1);
}

const c = new LyftaClient(key);

const s: any = await c.listWorkoutSummaries({ limit: 1 });
console.log("summaries:", s.status, "total_records:", s.total_records);

const e: any = await c.listExercises();
console.log("exercises:", e.status, "count:", e.count);

const w: any = await c.listWorkouts({ limit: 1 });
console.log("workouts:", w.status, "count:", w.count);
