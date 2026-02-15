# CLAUDE.md — ralph-mcp

MCP server that exposes ralph parallel mode as tools for Claude Desktop.

## Quick Reference

- **Runtime**: Deno + TypeScript
- **SDK**: `@modelcontextprotocol/sdk` (Zod-based tool registration)
- **Transport**: stdio
- **Start**: `deno run -A main.ts`

## Architecture

```
main.ts            → stdio transport setup
src/server.ts      → McpServer creation, tool registration loop
src/exec.ts        → Deno.Command wrapper, RALPH_HOME resolution
src/types.ts       → PRD/story TypeScript interfaces
src/tools/*.ts     → One file per tool, exports {name, description, params, handler}
```

Each tool file exports a Zod `params` shape and an async `handler(args) → string` that returns JSON.

## Environment

- `RALPH_HOME` — path to ralph installation (defaults to `../ralph` relative to this server)

## Tools

| Tool | Type | Description |
|------|------|-------------|
| `ralph_launch` | write | Start parallel agents (background, returns immediately) |
| `ralph_stop` | write | Graceful shutdown via stop.sh |
| `ralph_changes` | read | Delta since last check: new commits, story transitions, new logs, containers |
| `ralph_status` | read | Container health + story board + recent commits (includes `latest_commit`) |
| `ralph_logs` | read | Agent iteration log tails |
| `ralph_prd_read` | read | Full PRD with stories grouped by status |
| `ralph_prd_update` | write | Add/edit/remove stories, commits to bare repo |

## Testing

```bash
# Start server (blocks on stdio)
deno run -A main.ts

# Test with pipe (reads prd from smoke-test project)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ralph_prd_read","arguments":{"project_dir":"/path/to/project"}}}' | deno run -A main.ts
```
