import { describe, it, expect } from "vitest";
import { createServer as createHttp } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/http.js";

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
