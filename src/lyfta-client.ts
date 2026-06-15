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
}

type Query = Record<string, string | number | undefined>;

/**
 * Thin typed wrapper over the Lyfta Community REST API. Constructed with a key;
 * the key is sent as a Bearer header and never logged.
 */
export class LyftaClient {
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(
    private apiKey: string,
    opts: LyftaClientOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? process.env.LYFTA_BASE_URL ?? "https://my.lyfta.app";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<any> {
    const url = new URL(path, this.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

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

  listWorkouts(q: { page?: number; limit?: number } = {}) {
    return this.request("GET", "/api/v1/workouts", { query: q });
  }

  listWorkoutSummaries(q: { page?: number; limit?: number } = {}) {
    return this.request("GET", "/api/v1/workouts/summary", { query: q });
  }

  listExercises() {
    return this.request("GET", "/api/v1/exercises");
  }

  getExerciseProgress(q: { exercise_id: string; duration: number }) {
    return this.request("GET", "/api/v1/exercises/progress", { query: q });
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
