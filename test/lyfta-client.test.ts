import { describe, it, expect, vi } from "vitest";
import { LyftaClient } from "../src/lyfta-client.js";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
  );
}

describe("LyftaClient", () => {
  it("builds URL, query, and auth header for GET", async () => {
    const fetchImpl = mockFetch(200, { status: true, workouts: [] });
    const client = new LyftaClient("k", { baseUrl: "https://api.test", fetchImpl });
    await client.listWorkoutSummaries({ page: 2, limit: 50 });
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://api.test/api/v1/workouts/summary?page=2&limit=50");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("omits undefined query params", async () => {
    const fetchImpl = mockFetch(200, { status: true });
    const client = new LyftaClient("k", { baseUrl: "https://api.test", fetchImpl });
    await client.listWorkouts({ page: undefined, limit: 10 });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.test/api/v1/workouts?limit=10");
  });

  it("sends JSON body for POST", async () => {
    const fetchImpl = mockFetch(200, { status: true, id: "1" });
    const client = new LyftaClient("k", { baseUrl: "https://api.test", fetchImpl });
    await client.createCollection({ collection: { title: "A" } });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ collection: { title: "A" } });
  });

  it("throws LyftaApiError on HTTP error", async () => {
    const fetchImpl = mockFetch(400, { status: false, message: "bad" });
    const client = new LyftaClient("k", { baseUrl: "https://api.test", fetchImpl });
    await expect(client.listExercises()).rejects.toMatchObject({ status: 400, message: "bad" });
  });

  it("throws on status:false even with HTTP 200", async () => {
    const fetchImpl = mockFetch(200, { status: false, message: "nope" });
    const client = new LyftaClient("k", { baseUrl: "https://api.test", fetchImpl });
    await expect(client.listClients()).rejects.toMatchObject({ message: "nope" });
  });

  it("maps 429 with retry-after", async () => {
    const fetchImpl = mockFetch(429, "", { "retry-after": "30" });
    const client = new LyftaClient("k", { baseUrl: "https://api.test", fetchImpl });
    await expect(client.listExercises()).rejects.toMatchObject({ status: 429, retryAfter: "30" });
  });

  it("aborts and throws 408 when the upstream hangs past the timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const client = new LyftaClient("k", {
      baseUrl: "https://api.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    await expect(client.listExercises()).rejects.toMatchObject({ status: 408 });
  });
});
