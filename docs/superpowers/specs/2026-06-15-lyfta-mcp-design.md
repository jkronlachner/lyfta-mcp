# lyfta-mcp — Design Spec

**Date:** 2026-06-15
**Status:** Approved (locked in)

## Overview

A self-hostable [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the [Lyfta Community API](https://my.lyfta.app/community/api) as MCP tools, so an
MCP client (Claude Code, Claude Desktop, claude.ai) can read a user's Lyfta training data
and create programs/templates on their behalf.

Lyfta is a workout/strength-training tracker. The Community API is a Bearer-token REST API
(base `https://my.lyfta.app`), rate-limited to 60 req/min and 5,000 req/day.

## Goals

- Wrap all 7 Community API endpoints (5 read, 2 write) as well-described MCP tools.
- Run over **two transports** from one shared core: local **stdio** and remote **Streamable HTTP**.
- **No secret in the deployed artifact.** The Lyfta API key is supplied per request by the
  client, never stored or logged server-side.
- Be trivially self-hostable: `npm` bin for stdio, Docker image for HTTP.

## Non-Goals

- No multi-key vault, OAuth, or user accounts. Auth = "whatever Lyfta key the caller presents".
- No caching layer, no database, no background jobs.
- No re-modeling/normalizing of Lyfta's quirky field encodings (see Data Notes) — pass through faithfully.
- No write-gating flag (user chose full read+write enabled by default).

## Architecture

```
                ┌─────────────────────────────────────────┐
                │              server core                 │
  stdio.ts ───► │  createServer(): McpServer                │
 (env key)      │   ├─ registers 7 tools (zod input schemas)│
                │   └─ each handler: getKey() ──► LyftaClient│
  http.ts  ───► │                                           │
 (req header)   │  keyContext: AsyncLocalStorage<string>    │
                └─────────────────────────────────────────┘
                                  │
                                  ▼
                         LyftaClient(key)
                       fetch → https://my.lyfta.app
```

- **`server.ts`** — `createServer()` builds an `McpServer` and registers all tools. Pure;
  no transport, no process/env access. Testable in isolation.
- **`lyfta-client.ts`** — thin typed `fetch` wrapper. Constructed with a key, exposes one
  method per endpoint. Maps HTTP/`status:false` errors to typed errors. Never logs the key.
- **`key-context.ts`** — `AsyncLocalStorage<string>` holding the current request's key, plus a
  process-level default key. `getKey()` returns the ALS store if set, else the default, else
  throws a clear error. The ALS path serves HTTP (per request); the default serves stdio
  (one key for the process). This is how a key reaches a tool handler without being baked into
  the server or leaking across concurrent HTTP requests.
- **`stdio.ts`** — entrypoint. Reads `LYFTA_API_KEY` from env once and calls `setDefaultKey(key)`,
  then connects `StdioServerTransport`. (It does *not* wrap `connect()` in `keyContext.run()`:
  ALS context does not survive the long-lived stdin message listeners, so a process default is
  used instead.)
- **`http.ts`** — entrypoint. Express + `StreamableHTTPServerTransport`. Per request: extract
  key from the `Authorization: Bearer …` header, then `keyContext.run(key, () => handle(req))`.
  Returns 401 if the header is missing. Stateless mode (new transport per request).

### Why AsyncLocalStorage

The two transports differ only in *where the key comes from* (env once vs. header per
request). `AsyncLocalStorage` lets the identical tool handlers call `getKey()` regardless of
transport, and guarantees concurrent HTTP requests with different keys never bleed into each
other. No global mutable key, no key threaded through every function signature.

## Auth Model (locked in)

- **HTTP:** client sends `Authorization: Bearer <lyfta-key>`. Server reads it per request,
  runs the request inside `keyContext.run(key, …)` (ALS holds for the awaited request/response
  lifecycle), forwards it to Lyfta, stores nothing. The deployed artifact holds no secret.
- **stdio:** key from `LYFTA_API_KEY` env in the *local* client config (no remote deployment).
- The Lyfta key **is** the gate — no separate MCP auth token. An unauthenticated request
  (no header) is rejected with 401 before reaching any tool.
- **TLS is mandatory for HTTP** (keys ride in a header). README states this loudly. A public
  endpoint is technically an open relay to Lyfta (each caller uses their own key); README notes
  optional network restriction.

## Tools

All IDs are strings (Lyfta returns them as strings). Tool outputs return the API's JSON payload
as text content. Pagination params default sensibly and are clamped to API maxima.

### Read (GET)

1. **`list_workouts`** — `GET /api/v1/workouts`. Detailed workouts incl. exercises/sets.
   Input: `page?` (int ≥1, default 1), `limit?` (int 1–100, default 20). Clamped to 100.
2. **`list_workout_summaries`** — `GET /api/v1/workouts/summary`. Lightweight summaries.
   Input: `page?`, `limit?` (1–1000, default 50).
3. **`list_exercises`** — `GET /api/v1/exercises`. Performed-exercise catalog. No input.
4. **`get_exercise_progress`** — `GET /api/v1/exercises/progress`. Progress over time for one
   exercise. Input: `exercise_id` (string, required), `duration` (int days, required).
5. **`list_clients`** — `GET /api/v1/clients`. Coach API: active coaching clients. No input.
   (Returns a Lyfta error if the account is not a coach — surfaced as a tool error.)

### Write (POST)

6. **`create_collection`** — `POST /api/v1/collections`. Create a program/collection.
   Input: `title` (string, required, non-empty), `description?`, `goal?`, `image?` (base64),
   `client_id?` (coach only). Sends as `{collection:{…}, client_id?}`.
7. **`create_template`** — `POST /api/v1/templates`. Create a workout template in a collection.
   Input: `collectionId` (string, required), `workout` (object: title, description?, note?,
   color?, picture?, exercises[]), `clientId?` (coach only). `exercises[]` items carry
   `exercise_id`, `excercise_name` (sic — Lyfta's spelling), `exercise_type`, optional fields,
   and `sets[]` (`set_type_id`, `reps`/`from_reps`/`to_reps`, `weight`, `rir`, `duration`,
   `distance`). Zod schema mirrors the API; the tool description documents the shape.

Every tool description tells the model the rate limits and that IDs are strings.

## Data Notes (faithful pass-through)

Confirmed against the live API:
- IDs are JSON strings (`"22464849"`).
- `current_page` may be `null` even on success.
- Catalog fields (`equipment_id`, `body_part_id`, `Target_muscles_id`, `Synergist_muscles_id`)
  are **JSON-stringified arrays** (`"[\"3\"]"`) and may be the literal string `"null"`. We pass
  these through unchanged — re-parsing is out of scope and the numeric IDs lack a name lookup.

## Error & Rate-Limit Handling

- Non-2xx or `{status:false}` → throw `LyftaApiError(status, message)`. Tool handlers catch and
  return an MCP error result with a clean message (never the raw key/headers).
- `429` → surface "rate limit exceeded (60/min, 5000/day), retry later", including
  `Retry-After` if present. No automatic retry/backoff in v1 (YAGNI; the client decides).
- Missing/empty key → `getKey()` throws "No Lyfta API key in context" before any fetch.

## Configuration

| Var | Transport | Required | Meaning |
|-----|-----------|----------|---------|
| `LYFTA_API_KEY` | stdio | yes | Lyfta Bearer key |
| `PORT` | HTTP | no (default 3000) | HTTP listen port |
| `LYFTA_BASE_URL` | both | no (default `https://my.lyfta.app`) | override for testing |

## Stack & Layout

TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, `zod`, `express`. Build with `tsup`,
test with `vitest`.

```
lyfta-mcp/
├─ src/
│  ├─ lyfta-client.ts
│  ├─ key-context.ts
│  ├─ server.ts          # createServer() + tool registrations
│  ├─ tools/             # one file per tool group (read.ts, write.ts) OR inline in server.ts
│  ├─ stdio.ts           # bin: lyfta-mcp
│  └─ http.ts            # bin: lyfta-mcp-http
├─ test/                 # vitest, mocked fetch
├─ Dockerfile            # runs http.ts
├─ .env.example
├─ README.md
└─ package.json
```

## Testing Strategy

- **Unit (vitest, mocked `fetch`):** client builds correct URLs/headers/bodies; error mapping
  (4xx/5xx/`status:false`/429); each tool handler returns expected content; `getKey()` throws
  when context empty; pagination clamping.
- **Live smoke (manual, gated by real key, not in CI):** a script hits the read endpoints with a
  real key to confirm shapes. Writes tested cautiously (create one collection) and documented.
- Success criterion: `npm test` green; live read smoke returns real data; build produces both bins.

## Security

- Key never written to disk, logs, or git. `.gitignore` excludes `.env*` (except `.env.example`).
- HTTP requires TLS (deploy behind a TLS-terminating proxy / platform).
- No secret in the image or repo.
