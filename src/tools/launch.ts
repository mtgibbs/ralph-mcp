import { z } from "zod";
import { execBackground, getRalphHome } from "../exec.ts";
import { exec } from "../exec.ts";

export const launchTool = {
  name: "ralph_launch",
  description:
    "Launch ralph parallel agents against a project. Starts the orchestrator in the background and returns immediately. Use ralph_status to monitor progress.",
  params: {
    project_dir: z.string().describe("Absolute path to the project directory (must contain prd.json and be a git repo)"),
    agents: z.number().optional().describe("Number of builder agents (default: 2)"),
    researchers: z.number().optional().describe("Number of researcher agents with full internet access (default: 0)"),
    model: z.string().optional().describe("Claude model ID (default: claude-sonnet-4-5-20250929)"),
    memory: z.string().optional().describe("Per-container memory limit (default: 4g)"),
    cpus: z.number().optional().describe("Per-container CPU limit (default: 2)"),
    max_iterations: z.number().optional().describe("Per-agent iteration cap, 0 = run until PRD complete (default: 0)"),
    allow_domains: z.array(z.string()).optional().describe("Additional domains to whitelist for builder agents"),
  },

  async handler(args: {
    project_dir: string;
    agents?: number;
    researchers?: number;
    model?: string;
    memory?: string;
    cpus?: number;
    max_iterations?: number;
    allow_domains?: string[];
  }): Promise<string> {
    const ralphHome = getRalphHome();
    const script = `${ralphHome}/parallel/ralph-parallel.sh`;

    // Validate project dir exists and has prd.json
    try {
      await Deno.stat(`${args.project_dir}/prd.json`);
    } catch {
      return JSON.stringify({
        error: "Project directory does not contain prd.json",
        project_dir: args.project_dir,
      });
    }

    // Build command args
    const cmd = [script, "--project", args.project_dir];

    if (args.agents !== undefined) {
      cmd.push("--agents", String(args.agents));
    }
    if (args.researchers !== undefined) {
      cmd.push("--researcher", String(args.researchers));
    }
    if (args.model) {
      cmd.push("--model", args.model);
    }
    if (args.memory) {
      cmd.push("--memory", args.memory);
    }
    if (args.cpus !== undefined) {
      cmd.push("--cpus", String(args.cpus));
    }
    if (args.allow_domains) {
      for (const domain of args.allow_domains) {
        cmd.push("--allow-domain", domain);
      }
    }
    if (args.max_iterations !== undefined && args.max_iterations > 0) {
      cmd.push(String(args.max_iterations));
    }

    // Launch in background
    const _process = execBackground(cmd);

    // Give it a moment to start and check for immediate failures
    await new Promise((r) => setTimeout(r, 3000));

    // Check if containers are starting
    const dockerResult = await exec([
      "docker",
      "ps",
      "--filter",
      "name=ralph-",
      "--format",
      "{{.Names}}\t{{.Status}}",
    ]);

    const containers = dockerResult.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((line) => {
        const [name, status] = line.split("\t");
        return { name, status };
      });

    // Try to read any early stderr from the process
    let earlyOutput = "";
    try {
      const reader = _process.stderr.getReader();
      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ done: true; value: undefined }>(
        (r) => setTimeout(() => r({ done: true, value: undefined }), 1000),
      );
      const result = await Promise.race([readPromise, timeoutPromise]);
      reader.releaseLock();
      if (result.value) {
        earlyOutput = new TextDecoder().decode(result.value);
      }
    } catch {
      // Process may have already closed stderr
    }

    if (containers.length === 0 && earlyOutput) {
      return JSON.stringify({
        error: "Launch may have failed — no containers detected after 3s",
        stderr: earlyOutput.trim(),
        hint: "Check that Docker is running and the ralph image is built",
      });
    }

    return JSON.stringify(
      {
        launched: true,
        project_dir: args.project_dir,
        agents: args.agents ?? 2,
        researchers: args.researchers ?? 0,
        model: args.model ?? "claude-sonnet-4-5-20250929",
        containers: containers,
        note: "Orchestrator running in background. Use ralph_status to monitor progress.",
      },
      null,
      2,
    );
  },
};
