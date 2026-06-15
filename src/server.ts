import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LyftaClient, LyftaApiError } from "./lyfta-client.js";
import { getKey } from "./key-context.js";

const RATE = "Rate limits: 60 req/min, 5000 req/day. All IDs are strings.";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

async function runTool(fn: (c: LyftaClient) => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn(new LyftaClient(getKey()));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    const msg =
      e instanceof LyftaApiError
        ? `Lyfta API error (${e.status}): ${e.message}${e.retryAfter ? ` [retry-after: ${e.retryAfter}]` : ""}`
        : e instanceof Error
          ? e.message
          : String(e);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

const numStr = z.union([z.string(), z.number()]);

const setSchema = z
  .object({
    set_type_id: numStr.optional(),
    reps: numStr.optional(),
    from_reps: numStr.optional(),
    to_reps: numStr.optional(),
    weight: numStr.optional(),
    rir: numStr.optional(),
    duration: numStr.optional(),
    distance: numStr.optional(),
  })
  .passthrough();

const exerciseSchema = z
  .object({
    exercise_id: numStr,
    excercise_name: z.string().optional(),
    exercise_type: z.string().optional(),
    exercise_image: z.string().optional(),
    exercise_rest_time: numStr.optional(),
    exercise_note: z.string().optional(),
    is_rep_range_active: z.union([z.boolean(), numStr]).optional(),
    sets: z.array(setSchema).optional(),
  })
  .passthrough();

const workoutSchema = z
  .object({
    title: z.string(),
    description: z.string().optional(),
    note: z.string().optional(),
    color: z.string().optional(),
    picture: z.string().optional(),
    exercises: z.array(exerciseSchema).default([]),
  })
  .passthrough();

/** Build a fully-configured MCP server with all Lyfta tools registered. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "lyfta-mcp", version: "0.1.0" });

  server.registerTool(
    "list_workouts",
    {
      title: "List workouts",
      description: `Detailed workouts including exercises and sets, paginated (limit max 100). ${RATE}`,
      inputSchema: {
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ page, limit }) => runTool((c) => c.listWorkouts({ page, limit })),
  );

  server.registerTool(
    "list_workout_summaries",
    {
      title: "List workout summaries",
      description: `Lightweight workout summaries (id, title, duration, total_volume, date), paginated (limit max 1000). ${RATE}`,
      inputSchema: {
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
    },
    async ({ page, limit }) => runTool((c) => c.listWorkoutSummaries({ page, limit })),
  );

  server.registerTool(
    "list_exercises",
    {
      title: "List performed exercises",
      description: `Catalog of exercises the user has performed. Note: equipment/body-part/muscle IDs are returned as JSON-stringified arrays. ${RATE}`,
      inputSchema: {},
    },
    async () => runTool((c) => c.listExercises()),
  );

  server.registerTool(
    "get_exercise_progress",
    {
      title: "Get exercise progress",
      description: `Progress over time for one exercise (best weight/reps/volume, estimated 1RM). ${RATE}`,
      inputSchema: {
        exercise_id: z.string().describe("Exercise id (string)"),
        duration: z.number().int().min(1).describe("Look-back window in days"),
      },
    },
    async ({ exercise_id, duration }) =>
      runTool((c) => c.getExerciseProgress({ exercise_id, duration })),
  );

  server.registerTool(
    "list_clients",
    {
      title: "List coaching clients",
      description: `Coach API: active coaching clients. Errors if the account is not a coach. ${RATE}`,
      inputSchema: {},
    },
    async () => runTool((c) => c.listClients()),
  );

  server.registerTool(
    "create_collection",
    {
      title: "Create collection/program",
      description: `Create a new program/collection. Coaches may target a client via client_id. ${RATE}`,
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        goal: z.string().optional(),
        image: z.string().optional().describe("base64-encoded image"),
        client_id: z.string().optional().describe("coach only"),
      },
    },
    async ({ title, description, goal, image, client_id }) =>
      runTool((c) =>
        c.createCollection({
          collection: { title, description, goal, image },
          ...(client_id ? { client_id } : {}),
        }),
      ),
  );

  server.registerTool(
    "create_template",
    {
      title: "Create workout template",
      description: `Create a workout template inside an existing collection. Coaches may target a client via clientId. ${RATE}`,
      inputSchema: {
        collectionId: z.string(),
        workout: workoutSchema,
        clientId: z.string().optional().describe("coach only"),
      },
    },
    async ({ collectionId, workout, clientId }) =>
      runTool((c) =>
        c.createTemplate({ collectionId, workout, ...(clientId ? { clientId } : {}) }),
      ),
  );

  return server;
}
