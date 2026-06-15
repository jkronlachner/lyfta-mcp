import { describe, it, expect, vi, beforeEach } from "vitest";
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

  it("exposes all 7 tools", async () => {
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
    ]);
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
});
