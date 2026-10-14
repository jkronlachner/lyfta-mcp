import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { setDefaultKey } from "../src/key-context.js";

async function connect() {
  const server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const realFetch = globalThis.fetch;

/** Replace globalThis.fetch with a mock returning `body`; restored in afterEach. */
function stubFetch(body: unknown = { status: true }, status = 200) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  globalThis.fetch = fn as any;
  return fn;
}

function fetchedUrl(fn: ReturnType<typeof stubFetch>) {
  return String((fn.mock.calls[0] as unknown[])[0]);
}

describe("server tools", () => {
  beforeEach(() => {
    setDefaultKey("test-key");
    // URL assertions below expect the default host; a LYFTA_BASE_URL left in
    // the shell (e.g. for the smoke script) would otherwise break them.
    vi.stubEnv("LYFTA_BASE_URL", undefined);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it("exposes all 13 tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "create_collection",
      "create_template",
      "get_collection",
      "get_exercise_progress",
      "get_schedule",
      "get_template",
      "list_clients",
      "list_collections",
      "list_exercises",
      "list_templates",
      "list_workout_summaries",
      "list_workouts",
      "search_exercise_library",
    ]);
  });

  // create_template's pre-existing nested schema reuses zod instances, so it is
  // excluded; the read tools must stay flat for clients that don't resolve $ref.
  it("emits self-contained input schemas (no $ref) for read tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const t of tools.filter((t) => !t.name.startsWith("create_"))) {
      expect(JSON.stringify(t.inputSchema), t.name).not.toContain("$ref");
    }
  });

  it("reports the package.json version", async () => {
    const client = await connect();
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(client.getServerVersion()?.version).toBe(pkg.version);
  });

  it("list_exercises calls the API and returns JSON text", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: true, exercises: [{ id: "1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as any;
    const client = await connect();
    const res: any = await client.callTool({ name: "list_exercises", arguments: {} });
    expect(res.content[0].text).toContain('"id": "1"');
  });

  it("returns isError on API failure", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: false, message: "boom" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    ) as any;
    const client = await connect();
    const res: any = await client.callTool({ name: "list_clients", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("boom");
  });

  it("get_template calls the encoded template URL and passes the body through", async () => {
    const body = {
      status: true,
      data: { id: 5, title: "Push", exercises: [{ exercise_id: 1, excercise_name: "Bench" }] },
    };
    const fetchFn = stubFetch(body);
    const client = await connect();
    const res: any = await client.callTool({
      name: "get_template",
      arguments: { id: "5/x", client_id: "c1" },
    });
    expect(res.isError).toBeFalsy();
    expect(fetchedUrl(fetchFn)).toBe("https://my.lyfta.app/api/v1/templates/5%2Fx?client_id=c1");
    expect(JSON.parse(res.content[0].text)).toEqual(body);
  });

  it("get_template sends the Bearer key for the current request", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    await client.callTool({ name: "get_template", arguments: { id: "1" } });
    const init = (fetchFn.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(init.method).toBe("GET");
  });

  it("get_template rejects an empty id without calling fetch", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({ name: "get_template", arguments: { id: "" } });
    expect(res.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["get_template", "."],
    ["get_template", ".."],
    ["get_collection", "."],
    ["get_collection", ".."],
  ])("%s rejects id %j locally without calling fetch", async (name, id) => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({ name, arguments: { id } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Invalid id");
    // A local check, so it must not read as if Lyfta rejected the request.
    expect(res.content[0].text).not.toContain("Lyfta API error");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("get_collection forwards view and client_id", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    await client.callTool({
      name: "get_collection",
      arguments: { id: "9", view: "full", client_id: "c1" },
    });
    expect(fetchedUrl(fetchFn)).toBe(
      "https://my.lyfta.app/api/v1/collections/9?view=full&client_id=c1",
    );
  });

  it("get_collection rejects a view outside the enum without calling fetch", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({
      name: "get_collection",
      arguments: { id: "9", view: "detailed" },
    });
    expect(res.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("list_collections and list_templates forward pagination and client_id", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    await client.callTool({ name: "list_collections", arguments: { page: 2, limit: 5 } });
    await client.callTool({ name: "list_templates", arguments: { client_id: "c1" } });
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toBe(
      "https://my.lyfta.app/api/v1/collections?page=2&limit=5",
    );
    expect(String((fetchFn.mock.calls[1] as unknown[])[0])).toBe(
      "https://my.lyfta.app/api/v1/templates?client_id=c1",
    );
  });

  it.each([
    ["list_collections", { limit: 0 }],
    ["list_collections", { page: 0 }],
    ["list_collections", { limit: 1.5 }],
    ["list_templates", { limit: 0 }],
    ["list_templates", { page: 0 }],
    ["search_exercise_library", { limit: 0 }],
    ["search_exercise_library", { offset: -1 }],
    ["list_workouts", { limit: 101 }],
    ["list_workout_summaries", { limit: 1001 }],
  ])("%s rejects out-of-range %j without calling fetch", async (name, args) => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({ name, arguments: args });
    expect(res.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("get_schedule forwards dates, flag and client_id", async () => {
    const fetchFn = stubFetch({ status: true, workouts: [] });
    const client = await connect();
    const res: any = await client.callTool({
      name: "get_schedule",
      arguments: { from: "2026-09-01", to: "2026-09-01", include_completed: true, client_id: "c1" },
    });
    expect(res.isError).toBeFalsy();
    expect(fetchedUrl(fetchFn)).toBe(
      "https://my.lyfta.app/api/v1/schedule?from=2026-09-01&to=2026-09-01&client_id=c1&include_completed=true",
    );
  });

  it("get_schedule omits include_completed when false", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    await client.callTool({ name: "get_schedule", arguments: { include_completed: false } });
    expect(fetchedUrl(fetchFn)).toBe("https://my.lyfta.app/api/v1/schedule");
  });

  it.each(["2026-9-1", "01-09-2026", "2026-09-01T00:00:00Z", "2026-02-30", "2026-13-01"])(
    "get_schedule rejects invalid date %s without calling fetch",
    async (from) => {
      const fetchFn = stubFetch();
      const client = await connect();
      const res: any = await client.callTool({ name: "get_schedule", arguments: { from } });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/YYYY-MM-DD|calendar day/);
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("get_schedule accepts a leap day", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({
      name: "get_schedule",
      arguments: { from: "2028-02-29" },
    });
    expect(res.isError).toBeFalsy();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("get_schedule rejects from > to without calling fetch", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({
      name: "get_schedule",
      arguments: { from: "2026-09-08", to: "2026-09-01" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("must not be after");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("search_exercise_library forwards params and passes the nested envelope through", async () => {
    const body = {
      status: true,
      data: {
        results: [{ id: 1, name: "Bench Press" }],
        pagination: { limit: 1, offset: 0, total: 9, hasMore: true },
      },
    };
    const fetchFn = stubFetch(body);
    const client = await connect();
    const res: any = await client.callTool({
      name: "search_exercise_library",
      arguments: { search: "bench", limit: 1, offset: 0 },
    });
    expect(fetchedUrl(fetchFn)).toBe(
      "https://my.lyfta.app/api/v1/exercises/library?search=bench&limit=1&offset=0",
    );
    expect(JSON.parse(res.content[0].text)).toEqual(body);
  });

  it("search_exercise_library surfaces status:false as isError", async () => {
    stubFetch({ status: false, message: "library down" });
    const client = await connect();
    const res: any = await client.callTool({ name: "search_exercise_library", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("library down");
  });

  it("list_workouts forwards the date range and client_id", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({
      name: "list_workouts",
      arguments: { limit: 5, from: "2026-09-01", to: "2026-09-08", client_id: "c1" },
    });
    expect(res.isError).toBeFalsy();
    expect(fetchedUrl(fetchFn)).toBe(
      "https://my.lyfta.app/api/v1/workouts?limit=5&from=2026-09-01&to=2026-09-08&client_id=c1",
    );
  });

  it("list_workouts accepts a one-sided range", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    await client.callTool({ name: "list_workouts", arguments: { to: "2026-09-08" } });
    expect(fetchedUrl(fetchFn)).toBe("https://my.lyfta.app/api/v1/workouts?to=2026-09-08");
  });

  it.each(["2026/09/01", "2026-02-30", "yesterday"])(
    "list_workouts rejects invalid date %s without calling fetch",
    async (to) => {
      const fetchFn = stubFetch();
      const client = await connect();
      const res: any = await client.callTool({ name: "list_workouts", arguments: { to } });
      expect(res.isError).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("list_workouts rejects from > to without calling fetch", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({
      name: "list_workouts",
      arguments: { from: "2026-10-01", to: "2026-09-30" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("must not be after");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["list_workout_summaries", {}, "/api/v1/workouts/summary?client_id=c1"],
    ["list_exercises", {}, "/api/v1/exercises?client_id=c1"],
    [
      "get_exercise_progress",
      { exercise_id: "3", duration: 30 },
      "/api/v1/exercises/progress?exercise_id=3&duration=30&client_id=c1",
    ],
  ])("%s forwards client_id", async (name, args, path) => {
    const fetchFn = stubFetch();
    const client = await connect();
    await client.callTool({ name, arguments: { ...args, client_id: "c1" } });
    expect(fetchedUrl(fetchFn)).toBe(`https://my.lyfta.app${path}`);
  });

  it("marks every GET tool readOnlyHint and leaves create_* unannotated", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    expect(readOnly.sort()).toEqual(
      tools
        .map((t) => t.name)
        .filter((n) => !n.startsWith("create_"))
        .sort(),
    );
    expect(readOnly).toHaveLength(11);
    for (const t of tools.filter((t) => t.name.startsWith("create_"))) {
      expect(t.annotations?.readOnlyHint, t.name).toBeUndefined();
    }
  });

  it("get_schedule describes Lyfta's default window and points to list_workouts", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const desc = tools.find((t) => t.name === "get_schedule")?.description ?? "";
    expect(desc).toContain("+90 days");
    expect(desc).toContain("list_workouts");
  });

  it("tells the LLM where every client_id comes from", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const clientIdFields = tools.flatMap((t) => {
      const props = (t.inputSchema.properties ?? {}) as Record<string, any>;
      return ["client_id", "clientId"]
        .filter((key) => props[key])
        .map((key) => ({ name: `${t.name}.${key}`, field: props[key] }));
    });
    expect(clientIdFields.map((f) => f.name)).toContain("create_template.clientId");
    expect(clientIdFields.length).toBeGreaterThanOrEqual(11);
    for (const { name, field } of clientIdFields) {
      expect(field.description, name).toContain("list_clients");
    }
  });

  it("treats an empty client_id as not given", async () => {
    const fetchFn = stubFetch();
    const client = await connect();
    await client.callTool({ name: "list_exercises", arguments: { client_id: "" } });
    expect(fetchedUrl(fetchFn)).toBe("https://my.lyfta.app/api/v1/exercises");
  });

  /** The method, URL and parsed JSON body of the single request sent to Lyfta. */
  function sent(fn: ReturnType<typeof stubFetch>) {
    const [url, init] = fn.mock.calls[0] as unknown as [URL, RequestInit];
    return { method: init.method, url: String(url), body: JSON.parse(init.body as string) };
  }

  it("create_collection POSTs the collection wrapper and client_id", async () => {
    const fetchFn = stubFetch({ status: true, id: "9" });
    const client = await connect();
    const res: any = await client.callTool({
      name: "create_collection",
      arguments: { title: "Block 1", goal: "strength", client_id: "c1" },
    });
    expect(res.isError).toBeFalsy();
    expect(sent(fetchFn)).toEqual({
      method: "POST",
      url: "https://my.lyfta.app/api/v1/collections",
      body: { collection: { title: "Block 1", goal: "strength" }, client_id: "c1" },
    });
  });

  it.each([undefined, ""])("create_collection drops client_id %j", async (client_id) => {
    const fetchFn = stubFetch();
    const client = await connect();
    await client.callTool({ name: "create_collection", arguments: { title: "A", client_id } });
    expect(sent(fetchFn).body).toEqual({ collection: { title: "A" } });
  });

  it("create_template POSTs collectionId, workout and clientId as given", async () => {
    const fetchFn = stubFetch({ status: true, id: "3" });
    const client = await connect();
    const workout = {
      title: "Push",
      exercises: [{ exercise_id: 1, sets: [{ reps: "8", weight: 60 }] }],
    };
    await client.callTool({
      name: "create_template",
      arguments: { collectionId: "9", workout, clientId: "c1" },
    });
    expect(sent(fetchFn)).toEqual({
      method: "POST",
      url: "https://my.lyfta.app/api/v1/templates",
      body: { collectionId: "9", workout, clientId: "c1" },
    });
  });

  it.each([undefined, ""])(
    "create_template defaults exercises to [] and drops clientId %j",
    async (clientId) => {
      const fetchFn = stubFetch();
      const client = await connect();
      await client.callTool({
        name: "create_template",
        arguments: { collectionId: "9", workout: { title: "Rest" }, clientId },
      });
      expect(sent(fetchFn).body).toEqual({
        collectionId: "9",
        workout: { title: "Rest", exercises: [] },
      });
    },
  );

  it.each([
    ["create_collection", { title: "" }],
    ["create_template", { collectionId: "9", workout: { exercises: [] } }],
  ])("%s rejects a missing title without calling fetch", async (name, args) => {
    const fetchFn = stubFetch();
    const client = await connect();
    const res: any = await client.callTool({ name, arguments: args });
    expect(res.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("surfaces a 429 with its retry-after hint", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 429, headers: { "retry-after": "30" } }),
    ) as any;
    const client = await connect();
    const res: any = await client.callTool({ name: "get_schedule", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^Lyfta API error \(429\): .*\[retry-after: 30\]$/);
  });

  it("surfaces a non-JSON upstream page as isError with its status", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("<html>Bad gateway</html>", { status: 502 }),
    ) as any;
    const client = await connect();
    const res: any = await client.callTool({ name: "list_templates", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Lyfta API error (502)");
  });

  it("surfaces a network failure as isError instead of crashing the call", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as any;
    const client = await connect();
    const res: any = await client.callTool({ name: "list_collections", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("fetch failed");
  });
});
