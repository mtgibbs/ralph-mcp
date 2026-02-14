import { z } from "zod";
import { exec, getRalphHome } from "../exec.ts";
import type { PRD } from "../types.ts";

interface ContainerInfo {
  name: string;
  status: string;
  running_for: string;
}

interface StoryStatus {
  available: { id: string; title: string; priority: number }[];
  claimed: {
    id: string;
    title: string;
    claimed_by: string;
    claimed_at: string;
  }[];
  done: { id: string; title: string }[];
  progress: string;
}

interface StatusResult {
  project: string;
  stop_requested: boolean;
  containers: ContainerInfo[];
  stories: StoryStatus;
  recent_commits: string[];
}

export const statusTool = {
  name: "ralph_status",
  description:
    "Get the current status of ralph parallel agents: container health, story board progress, and recent commits.",
  params: {
    project_dir: z.string().describe("Absolute path to the project directory"),
  },

  async handler(args: { project_dir: string }): Promise<string> {
    const { project_dir } = args;
    const _ralphHome = getRalphHome();

    // Run docker ps, prd read, and git log in parallel
    const [dockerResult, prdResult, commitsResult] = await Promise.all([
      exec([
        "docker",
        "ps",
        "--filter",
        "name=ralph-",
        "--format",
        "{{.Names}}\t{{.Status}}\t{{.RunningFor}}",
      ]),
      readPrdFromBareRepo(project_dir),
      // Read commits from bare repo (where agents push), fallback to working dir
      exec(["git", "log", "--oneline", "-10", "--all"], {
        cwd: `${project_dir}/.ralph/repo.git`,
      }).catch(() =>
        exec(["git", "log", "--oneline", "-10"], { cwd: project_dir })
      ),
    ]);

    // Check for stop signal (file must be non-empty, matching shell's -s check)
    let stopRequested = false;
    try {
      const stat = await Deno.stat(`${project_dir}/.ralph/stop_requested`);
      stopRequested = stat.size > 0;
    } catch {
      // File doesn't exist = not requested
    }

    // Parse container info
    const containers: ContainerInfo[] = dockerResult.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, status, running_for] = line.split("\t");
        return { name, status, running_for };
      });

    // Parse PRD into story status
    const stories: StoryStatus = {
      available: [],
      claimed: [],
      done: [],
      progress: "unknown",
    };

    if (prdResult) {
      for (const story of prdResult.userStories) {
        if (story.passes) {
          stories.done.push({ id: story.id, title: story.title });
        } else if (story.claimed_by) {
          stories.claimed.push({
            id: story.id,
            title: story.title,
            claimed_by: story.claimed_by,
            claimed_at: story.claimed_at ?? "unknown",
          });
        } else {
          stories.available.push({
            id: story.id,
            title: story.title,
            priority: story.priority,
          });
        }
      }
      stories.progress =
        `${stories.done.length}/${prdResult.userStories.length} stories complete`;
    }

    const commits = commitsResult.success
      ? commitsResult.stdout
        .trim()
        .split("\n")
        .filter((l) => l.length > 0)
      : [];

    const result: StatusResult = {
      project: project_dir,
      stop_requested: stopRequested,
      containers,
      stories,
      recent_commits: commits,
    };

    return JSON.stringify(result, null, 2);
  },
};

/** Read prd.json from the bare repo if it exists, fallback to working dir */
async function readPrdFromBareRepo(projectDir: string): Promise<PRD | null> {
  const bareRepo = `${projectDir}/.ralph/repo.git`;
  try {
    await Deno.stat(bareRepo);
    const result = await exec(
      ["git", "show", "HEAD:prd.json"],
      { cwd: bareRepo },
    );
    if (result.success) {
      return JSON.parse(result.stdout);
    }
  } catch {
    // Fall through
  }

  try {
    const text = await Deno.readTextFile(`${projectDir}/prd.json`);
    return JSON.parse(text);
  } catch {
    return null;
  }
}
