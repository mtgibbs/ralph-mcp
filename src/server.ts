import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  changesTool,
  launchTool,
  logsTool,
  prdReadTool,
  prdUpdateTool,
  statusTool,
  stopTool,
} from "./tools/index.ts";

// deno-lint-ignore no-explicit-any
function registerTool(server: McpServer, tool: { name: string; description: string; params: any; handler: any }) {
  server.tool(
    tool.name,
    tool.description,
    tool.params,
    // deno-lint-ignore no-explicit-any
    async (args: any) => {
      try {
        const result = await tool.handler(args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    },
  );
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "ralph-mcp",
    version: "0.1.0",
  });

  registerTool(server, changesTool);
  registerTool(server, launchTool);
  registerTool(server, stopTool);
  registerTool(server, statusTool);
  registerTool(server, logsTool);
  registerTool(server, prdReadTool);
  registerTool(server, prdUpdateTool);

  return server;
}
