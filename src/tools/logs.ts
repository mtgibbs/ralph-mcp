import { z } from "zod";

export const logsTool = {
  name: "ralph_logs",
  description:
    "Read agent iteration logs from the agent_logs/ directory. Can filter by agent ID and control how many lines to return.",
  params: {
    project_dir: z.string().describe("Absolute path to the project directory"),
    agent_id: z.string().optional().describe("Filter to a specific agent (e.g. 'agent-1'). Omit for all agents."),
    lines: z.number().optional().describe("Number of lines to return from each log file (default: 50)"),
  },

  async handler(args: {
    project_dir: string;
    agent_id?: string;
    lines?: number;
  }): Promise<string> {
    const logsDir = `${args.project_dir}/agent_logs`;
    const lines = args.lines ?? 50;

    // List log files
    const logFiles: string[] = [];
    try {
      for await (const entry of Deno.readDir(logsDir)) {
        if (entry.isFile && entry.name.endsWith(".log")) {
          if (args.agent_id) {
            if (entry.name.startsWith(args.agent_id)) {
              logFiles.push(entry.name);
            }
          } else {
            logFiles.push(entry.name);
          }
        }
      }
    } catch {
      return JSON.stringify({
        error: "No agent_logs directory found",
        path: logsDir,
      });
    }

    if (logFiles.length === 0) {
      return JSON.stringify({
        logs: [],
        message: args.agent_id
          ? `No logs found for agent '${args.agent_id}'`
          : "No log files found",
      });
    }

    // Sort by modification time, most recent first
    const fileStats = await Promise.all(
      logFiles.map(async (name) => {
        const stat = await Deno.stat(`${logsDir}/${name}`);
        return { name, mtime: stat.mtime?.getTime() ?? 0 };
      }),
    );
    fileStats.sort((a, b) => b.mtime - a.mtime);

    // Read the most recent log files (limit to 5 to avoid huge responses)
    const maxFiles = 5;
    const results = await Promise.all(
      fileStats.slice(0, maxFiles).map(async ({ name }) => {
        const content = await Deno.readTextFile(`${logsDir}/${name}`);
        const allLines = content.split("\n");
        const tail = allLines.slice(-lines).join("\n");
        return {
          file: name,
          total_lines: allLines.length,
          showing_last: Math.min(lines, allLines.length),
          content: tail,
        };
      }),
    );

    return JSON.stringify(
      {
        total_log_files: fileStats.length,
        showing: results.length,
        logs: results,
      },
      null,
      2,
    );
  },
};
