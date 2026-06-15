# lyfta-mcp

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

```bash
git clone https://github.com/jkronlachner/lyfta-mcp.git
cd lyfta-mcp
npm install
npm run build
```

## Use over stdio (local)

The key lives only in your local client config — there is no deployment.

**Claude Code:**

```bash
claude mcp add lyfta \
  --env LYFTA_API_KEY=your-lyfta-api-key \
  -- node /absolute/path/to/lyfta-mcp/dist/stdio.js
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lyfta": {
      "command": "node",
      "args": ["/absolute/path/to/lyfta-mcp/dist/stdio.js"],
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
PORT=3000 npm run start:http
# or: docker build -t lyfta-mcp . && docker run -p 3000:3000 lyfta-mcp
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

The HTTP transport ignores `LYFTA_API_KEY` — it always uses the per-request header.

## Development

```bash
npm test          # unit + transport tests (vitest)
npm run typecheck # tsc --noEmit
npm run dev:stdio # run stdio from source (needs LYFTA_API_KEY)
npm run dev:http  # run HTTP from source
LYFTA_API_KEY=<real> npm run smoke   # live read smoke test against Lyfta
```

> Note: `npm audit` reports advisories in `esbuild`, pulled in transitively by the `tsup`/`vitest`
> dev toolchain. These are **dev-only** and are not present in the published `dist/` artifact or the
> Docker image.

## Security notes

- The API key is never written to disk, logs, or git. `.env*` is git-ignored (except `.env.example`).
- The deployed HTTP artifact contains no secret.
- Treat your Lyfta key like a password. If it leaks, rotate it at <https://my.lyfta.app/community/api>.

## License

[MIT](./LICENSE) © 2026 Julian Kronlachner
