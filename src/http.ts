import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { keyContext } from "./key-context.js";

function bearer(req: Request): string | undefined {
  // RFC 6750: the auth scheme is case-insensitive; tolerate extra whitespace.
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  return m?.[1]?.trim() || undefined;
}

/** Build the Express app exposing the MCP server over Streamable HTTP. */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const key = bearer(req);
    if (!key) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Missing 'Authorization: Bearer <lyfta-key>' header." },
        id: null,
      });
      return;
    }

    await keyContext.run(key, async () => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error" },
            id: null,
          });
        }
      }
    });
  });

  // Stateless server: no SSE stream or session teardown over GET/DELETE.
  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.error(
      `lyfta-mcp HTTP listening on :${port} (POST /mcp). TLS MUST be terminated in front of this.`,
    );
  });
}
