# lyfta-mcp

[![CI](https://github.com/jkronlachner/lyfta-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jkronlachner/lyfta-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lyfta-mcp.svg)](https://www.npmjs.com/package/lyfta-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A self-hostable [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the [Lyfta Community API](https://my.lyfta.app/community/api) as tools, so an MCP client
(Claude Code, Claude Desktop, claude.ai) can read your Lyfta training data and create
programs/templates on your behalf.

Runs over **two transports** from one codebase:

- **stdio** — local subprocess of your MCP client. Key comes from a `LYFTA_API_KEY` env var.
- **Streamable HTTP** — deploy once, connect remote clients. **The key is supplied by the client
  on every request via the `Authorization` header and is never stored or logged server-side.**

## Tools

| Tool | Method | Description |
|------|--------|-------------|
| `list_workouts` | GET | Detailed workouts incl. exercises and sets (paginated, limit ≤ 100). |
| `list_workout_summaries` | GET | Lightweight workout summaries (paginated, limit ≤ 1000). |
| `list_exercises` | GET | Catalog of exercises you've performed. |
| `get_exercise_progress` | GET | Progress over time for one exercise (`exercise_id`, `duration` days). |
| `list_clients` | GET | Coach API — your active coaching clients. |
| `create_collection` | POST | Create a program/collection. |
| `create_template` | POST | Create a workout template inside a collection. |

All IDs are strings. Lyfta enforces rate limits of **60 req/min** and **5,000 req/day**; a `429`
is surfaced to the client with the `Retry-After` value when present.

## Get a Lyfta API key

Generate one at <https://my.lyfta.app/community/api>. **It is shown once — store it safely.**
The Coach API tools require a paid coaching plan.

## Install

Published on [npm](https://www.npmjs.com/package/lyfta-mcp) — **no clone or build required** (needs
Node ≥ 20). `npx` fetches and runs it on demand:

```bash
npx -y lyfta-mcp                      # stdio transport
npx -y -p lyfta-mcp lyfta-mcp-http    # Streamable HTTP transport
```

The HTTP bin needs `-p lyfta-mcp` because its name differs from the package name. Pin a version with
`lyfta-mcp@latest` (or a specific tag) if you prefer. Prebuilt HTTP images are on GHCR:
`ghcr.io/jkronlachner/lyfta-mcp`.

Working on the server itself? See **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)**.

## Use over stdio (local)

The key lives only in your local client config — there is no deployment.

**Claude Code:**

```bash
claude mcp add lyfta \
  --env LYFTA_API_KEY=your-lyfta-api-key \
  -- npx -y lyfta-mcp
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lyfta": {
      "command": "npx",
      "args": ["-y", "lyfta-mcp"],
      "env": { "LYFTA_API_KEY": "your-lyfta-api-key" }
    }
  }
}
```

## Use over HTTP (self-hosted)

The server holds **no** key. Each client sends its own key as a Bearer header; the server forwards
it to Lyfta and stores nothing.

Run it:

```bash
PORT=3000 npx -y -p lyfta-mcp lyfta-mcp-http
# or via the prebuilt image:
docker run -p 3000:3000 ghcr.io/jkronlachner/lyfta-mcp:latest
```

Connect from Claude Code (replace the URL with your deployed, TLS-terminated endpoint):

```bash
claude mcp add --transport http lyfta https://your-host.example.com/mcp \
  --header "Authorization: Bearer your-lyfta-api-key"
```

Endpoints: `POST /mcp` (MCP), `GET /healthz` (health check). The server is stateless — `GET`/`DELETE`
on `/mcp` return `405`.

### ⚠️ HTTP security

- **TLS is mandatory.** The Lyfta key travels in the `Authorization` header on every request. Always
  deploy behind a TLS-terminating reverse proxy or platform (never plain HTTP). The container listens
  on plain HTTP by design — terminate TLS in front of it.
- A request without a valid `Authorization: Bearer <key>` header is rejected with `401` before
  reaching any tool. **Lyfta's own auth is the gate** — there's no separate server token.
- Because the server forwards whatever key the caller presents, a public endpoint is technically an
  **open relay** to Lyfta (each caller authenticates as themselves). If that matters to you, restrict
  access at the network layer (firewall, private network, VPN, IP allow-list).

## Configuration

| Var | Transport | Required | Default | Meaning |
|-----|-----------|----------|---------|---------|
| `LYFTA_API_KEY` | stdio | yes | — | Your Lyfta Bearer key |
| `PORT` | HTTP | no | `3000` | HTTP listen port |
| `LYFTA_BASE_URL` | both | no | `https://my.lyfta.app` | API base URL override |
| `LYFTA_TIMEOUT_MS` | both | no | `30000` | Per-request upstream timeout (ms) |

The HTTP transport ignores `LYFTA_API_KEY` — it always uses the per-request header.

## Development

Building, running from source, tests, and the smoke check live in
**[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)**.

## Security notes

- The API key is never written to disk, logs, or git. `.env*` is git-ignored (except `.env.example`).
- The deployed HTTP artifact contains no secret.
- Treat your Lyfta key like a password. If it leaks, rotate it at <https://my.lyfta.app/community/api>.

## License

[MIT](./LICENSE) © 2026 Julian Kronlachner
