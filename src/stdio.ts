import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { setDefaultKey } from "./key-context.js";

const key = process.env.LYFTA_API_KEY;
if (!key) {
  console.error("Error: LYFTA_API_KEY env var is required for the stdio transport.");
  process.exit(1);
}
setDefaultKey(key);

const server = createServer();
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
