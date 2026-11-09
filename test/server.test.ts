import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("server tools", () => {
  beforeEach(() => setDefaultKey("test-key"));

  it("exposes all 8 tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "create_collection",
      "create_template",
      "get_exercise_progress",
      "list_clients",
      "list_exercises",
      "list_workout_summaries",
      "list_workouts",
      "search_exercise_library",
    ]);
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

  it("search_exercise_library hits /exercises/library with search/limit/offset", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: true, data: { results: [{ id: "2", name: "Bench Press" }] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as any;
    const client = await connect();
    const res: any = await client.callTool({
      name: "search_exercise_library",
      arguments: { search: "bench press", limit: 5, offset: 10 },
    });
    const url = new URL(String((fetchMock.mock.calls[0] as any[])[0]));
    expect(url.pathname).toBe("/api/v1/exercises/library");
    expect(url.searchParams.get("search")).toBe("bench press");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("offset")).toBe("10");
    expect(res.content[0].text).toContain('"id": "2"');
  });

  it("list_exercises forwards page/limit", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: true, exercises: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as any;
    const client = await connect();
    await client.callTool({ name: "list_exercises", arguments: { page: 2, limit: 50 } });
    const url = new URL(String((fetchMock.mock.calls[0] as any[])[0]));
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("50");
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
});
