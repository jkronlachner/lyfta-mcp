# Development

For hacking on the server itself. If you just want to *use* lyfta-mcp, you don't need any of
this — see the [README](../README.md) (`npx -y lyfta-mcp`).

## Setup

Requires Node ≥ 20.

```bash
git clone https://github.com/jkronlachner/lyfta-mcp.git
cd lyfta-mcp
npm install
```

## Run from source

`tsx` runs the TypeScript directly — no build step needed during development.

```bash
LYFTA_API_KEY=your-lyfta-api-key npm run dev:stdio   # stdio transport
PORT=3000 npm run dev:http                           # HTTP transport (POST /mcp)
```

For the HTTP transport, the key is **not** an env var — send it per request:

```bash
curl -s http://localhost:3000/mcp \
  -H "Authorization: Bearer your-lyfta-api-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Point a local MCP client at your working tree

Build first, then reference the compiled entrypoint:

```bash
npm run build
claude mcp add lyfta-dev \
  --env LYFTA_API_KEY=your-lyfta-api-key \
  -- node "$(pwd)/dist/stdio.js"
```

## Checks

```bash
npm test          # unit + transport tests (vitest)
npm run typecheck # tsc --noEmit
npm run build     # bundle to dist/ via tsup
LYFTA_API_KEY=<real> npm run smoke   # live read-only smoke test against Lyfta
```

Run all three (`test`, `typecheck`, `build`) before pushing — CI runs them on Node 20 and 22.

> `npm audit` reports advisories in `esbuild`, pulled in transitively by the `tsup`/`vitest` dev
> toolchain. These are **dev-only** — not present in the published `dist/` artifact or the Docker
> image.

## Releasing

Releases are automated via [release-please](https://github.com/googleapis/release-please) — use
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`,
`ci:`). On merge to `main`, release-please maintains a release PR; merging that PR tags the release,
updates the CHANGELOG, and publishes to npm (tokenless, via Trusted Publishing) and GHCR.

`feat:` bumps the minor version, `fix:` the patch. The server reports its version from
`package.json` at runtime, so no manual version edits are needed.
