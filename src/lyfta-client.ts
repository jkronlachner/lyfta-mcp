/** Error raised for any non-success response from the Lyfta API. */
export class LyftaApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: string,
  ) {
    super(message);
    this.name = "LyftaApiError";
  }
}

export interface LyftaClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Defaults to LYFTA_TIMEOUT_MS or 30s. */
  timeoutMs?: number;
}

type Query = Record<string, string | number | undefined>;

/**
 * Encode an id for use as one path segment. Empty, "." and ".." are rejected:
 * URL resolution would collapse them and silently hit a different endpoint.
 * A plain Error, not LyftaApiError: Lyfta never saw the request.
 */
function pathSegment(id: string): string {
  if (id === "" || id === "." || id === "..") {
    throw new Error(`Invalid id: ${JSON.stringify(id)}`);
  }
  return encodeURIComponent(id);
}

/**
 * Thin typed wrapper over the Lyfta Community REST API. Constructed with a key;
 * the key is sent as a Bearer header and never logged.
 */
export class LyftaClient {
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(
    private apiKey: string,
    opts: LyftaClientOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? process.env.LYFTA_BASE_URL ?? "https://my.lyfta.app";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? (Number(process.env.LYFTA_TIMEOUT_MS) || 30_000);
  }

  private async request(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<any> {
    const url = new URL(path, this.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        // "" too: an empty client_id/search means "not given", not "match empty".
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ac.signal,
      });
    } catch (e) {
      if (ac.signal.aborted) {
        throw new LyftaApiError(408, `Lyfta API request timed out after ${this.timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      throw new LyftaApiError(
        429,
        "Lyfta rate limit exceeded (60/min, 5000/day). Retry later.",
        res.headers.get("retry-after") ?? undefined,
      );
    }

    const text = await res.text();
    let json: any = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new LyftaApiError(
          res.status,
          `Lyfta API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
        );
      }
    }
    if (!res.ok || json?.status === false) {
      throw new LyftaApiError(res.status, json?.message ?? `Lyfta API error (HTTP ${res.status})`);
    }
    return json;
  }

  listWorkouts(
    q: { page?: number; limit?: number; from?: string; to?: string; client_id?: string } = {},
  ) {
    return this.request("GET", "/api/v1/workouts", { query: q });
  }

  listWorkoutSummaries(q: { page?: number; limit?: number; client_id?: string } = {}) {
    return this.request("GET", "/api/v1/workouts/summary", { query: q });
  }

  listExercises(q: { client_id?: string } = {}) {
    return this.request("GET", "/api/v1/exercises", { query: q });
  }

  getExerciseProgress(q: { exercise_id: string; duration: number; client_id?: string }) {
    return this.request("GET", "/api/v1/exercises/progress", { query: q });
  }

  listCollections(q: { page?: number; limit?: number; client_id?: string } = {}) {
    return this.request("GET", "/api/v1/collections", { query: q });
  }

  // async so a bad id from pathSegment() rejects like an API error, not a sync throw.
  async getCollection(id: string, q: { view?: "summary" | "full"; client_id?: string } = {}) {
    return this.request("GET", `/api/v1/collections/${pathSegment(id)}`, { query: q });
  }

  listTemplates(q: { page?: number; limit?: number; client_id?: string } = {}) {
    return this.request("GET", "/api/v1/templates", { query: q });
  }

  // async: see getCollection.
  async getTemplate(id: string, q: { client_id?: string } = {}) {
    return this.request("GET", `/api/v1/templates/${pathSegment(id)}`, { query: q });
  }

  getSchedule(
    q: { from?: string; to?: string; include_completed?: boolean; client_id?: string } = {},
  ) {
    // Only send the flag when set: Lyfta defaults to false, and "false" in a
    // query string is easy for a server to misread as truthy.
    const { include_completed, ...rest } = q;
    return this.request("GET", "/api/v1/schedule", {
      query: { ...rest, include_completed: include_completed ? "true" : undefined },
    });
  }

  searchExerciseLibrary(q: { search?: string; limit?: number; offset?: number } = {}) {
    return this.request("GET", "/api/v1/exercises/library", { query: q });
  }

  listClients() {
    return this.request("GET", "/api/v1/clients");
  }

  createCollection(body: unknown) {
    return this.request("POST", "/api/v1/collections", { body });
  }

  createTemplate(body: unknown) {
    return this.request("POST", "/api/v1/templates", { body });
  }
}
