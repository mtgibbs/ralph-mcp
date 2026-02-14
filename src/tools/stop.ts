import { z } from "zod";
import { exec, getRalphHome } from "../exec.ts";

export const stopTool = {
  name: "ralph_stop",
  description:
    "Gracefully stop all ralph parallel agents for a project. Signals agents to finish their current iteration, then waits for containers to exit (up to 120s timeout before force-kill).",
  params: {
    project_dir: z.string().describe("Absolute path to the project directory"),
  },

  async handler(args: { project_dir: string }): Promise<string> {
    const ralphHome = getRalphHome();
    const script = `${ralphHome}/parallel/stop.sh`;

    // Check if any ralph containers are running first
    const dockerCheck = await exec([
      "docker",
      "ps",
      "--filter",
      "name=ralph-",
      "--format",
      "{{.Names}}",
    ]);

    const runningBefore = dockerCheck.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    if (runningBefore.length === 0) {
      return JSON.stringify({
        stopped: true,
        message: "No ralph containers were running",
        containers_stopped: 0,
      });
    }

    // Run stop script
    const result = await exec(
      [script, "--project", args.project_dir],
      { cwd: args.project_dir },
    );

    // Check what's still running after
    const dockerAfter = await exec([
      "docker",
      "ps",
      "--filter",
      "name=ralph-",
      "--format",
      "{{.Names}}",
    ]);

    const runningAfter = dockerAfter.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    return JSON.stringify(
      {
        stopped: result.success,
        containers_before: runningBefore,
        containers_still_running: runningAfter,
        containers_stopped: runningBefore.length - runningAfter.length,
        output: result.stdout.trim(),
        error: result.success ? undefined : result.stderr.trim(),
      },
      null,
      2,
    );
  },
};
