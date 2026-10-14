import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer as createHttp } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/http.js";
import { setDefaultKey } from "../src/key-context.js";

async function post(headers: Record<string, string>, body: unknown) {
  const server = createHttp(createApp());
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  } finally {
    server.close();
  }
}

const initMsg = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
};

describe("http transport", () => {
  it("rejects requests without Authorization", async () => {
    const { status } = await post({}, initMsg);
    expect(status).toBe(401);
  });

  it("accepts initialize with a Bearer key", async () => {
    const { status, text } = await post({ Authorization: "Bearer abc" }, initMsg);
    expect(status).toBe(200);
    expect(text).toContain("serverInfo");
  });

  it("accepts a case-insensitive scheme (RFC 6750)", async () => {
    const { status } = await post({ Authorization: "bearer  abc" }, initMsg);
    expect(status).toBe(200);
  });

  it("returns 405 for GET /mcp", async () => {
    const server = createHttp(createApp());
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "GET" });
      expect(res.status).toBe(405);
    } finally {
      server.close();
    }
  });
});

const realFetch = globalThis.fetch;

/**
 * Mock Lyfta while letting the test's own requests reach the local server.
 * Each Lyfta call waits `delayMs` so concurrent requests overlap in flight.
 */
function stubLyfta(delayMs = 0) {
  const calls: { url: string; auth: string }[] = [];
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    calls.push({ url, auth: (init?.headers as Record<string, string>).Authorization });
    await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify({ status: true, data: { url } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as any;
  return calls;
}

function callTool(id: number, name: string, args: unknown) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

/** The JSON-RPC result from a plain JSON or single-event SSE response body. */
function rpcResult(text: string): any {
  const data = text.startsWith("{") ? text : /^data: (.*)$/m.exec(text)?.[1];
  return JSON.parse(data ?? "null").result;
}

describe("http transport tool calls", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    setDefaultKey(undefined);
  });

  it("runs a tool over HTTP and forwards that request's key to Lyfta", async () => {
    const calls = stubLyfta();
    const { status, text } = await post(
      { Authorization: "Bearer key-a" },
      callTool(2, "get_template", { id: "7" }),
    );
    expect(status).toBe(200);
    expect(rpcResult(text).isError).toBeFalsy();
    expect(calls).toEqual([
      { url: "https://my.lyfta.app/api/v1/templates/7", auth: "Bearer key-a" },
    ]);
  });

  it("keeps keys isolated between concurrent requests", async () => {
    // A process default must never win over, or leak into, a request's own key.
    setDefaultKey("default-key");
    const calls = stubLyfta(20);
    const results = await Promise.all(
      ["a", "b", "c"].map((k, i) =>
        post({ Authorization: `Bearer key-${k}` }, callTool(i, "get_template", { id: k })),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(calls).toHaveLength(3);
    for (const { url, auth } of calls) {
      expect(auth).toBe(`Bearer key-${url.slice(-1)}`);
    }
  });

  it("lists all 13 tools over HTTP", async () => {
    const { text } = await post(
      { Authorization: "Bearer abc" },
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
    );
    expect(rpcResult(text).tools).toHaveLength(13);
  });
});
