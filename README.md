# ralph-mcp

MCP server for orchestrating [ralph](https://github.com/snarktank/ralph) parallel agents from Claude Desktop.

Lets you manage multi-agent coding sessions conversationally: launch agents, monitor progress, read logs, and update requirements — all through natural language.

## Prerequisites

- [Deno](https://deno.land/) installed
- [ralph](https://github.com/snarktank/ralph) cloned and Docker image built
- Docker running

## Setup

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ralph": {
      "command": "deno",
      "args": ["run", "-A", "/Users/YOU/path/to/ralph-mcp/main.ts"],
      "env": {
        "RALPH_HOME": "/Users/YOU/path/to/ralph"
      }
    }
  }
}
```

### Claude Code Configuration

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "ralph": {
      "command": "deno",
      "args": ["run", "-A", "/Users/YOU/path/to/ralph-mcp/main.ts"],
      "env": {
        "RALPH_HOME": "/Users/YOU/path/to/ralph"
      }
    }
  }
}
```

## Tools

### Orchestration

- **`ralph_launch`** — Start agents against a project. Configurable: agent count, researcher count, model, memory, CPUs, iteration cap, domain allowlist.
- **`ralph_stop`** — Graceful shutdown. Signals agents to finish current iteration, waits up to 120s, then force-kills.
- **`ralph_status`** — Container health, story board (available/claimed/done), recent commits.

### Logs

- **`ralph_logs`** — Read agent iteration logs. Filter by agent ID, control line count.

### PRD Management

- **`ralph_prd_read`** — Read the full PRD with stories grouped by status.
- **`ralph_prd_update`** — Add, edit, or remove stories. Commits changes to the bare repo so running agents pick them up.

## Example Conversation

> "Launch 3 agents on my canvas project"

> "How are they doing?"

> "Add a new story for implementing the grade export feature"

> "What's agent-2 working on? Show me its recent logs"

> "Stop the agents, I want to review what they've done"
