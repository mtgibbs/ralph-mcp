import { z } from "zod";
import { exec } from "../exec.ts";
import type { PRD, UserStory } from "../types.ts";

interface ContainerInfo {
  name: string;
  status: string;
  running_for: string;
}

interface StoryTransition {
  id: string;
  title: string;
  from: string;
  to: string;
}

interface LogEntry {
  file: string;
  last_lines: string;
}

interface ChangesResult {
  project: string;
  since_commit: string;
  latest_commit: string;
  new_commits: { hash: string; message: string }[];
  story_transitions: StoryTransition[];
  new_log_entries: { new_count: number; recent_summaries: LogEntry[] };
  containers: { current: ContainerInfo[]; likely_new: string[] };
}

function storyStatus(s: UserStory): string {
  if (s.passes) return "done";
  if (s.claimed_by) return `claimed by ${s.claimed_by}`;
  return "available";
}

function diffStories(
  oldPrd: PRD | null,
  newPrd: PRD | null,
): StoryTransition[] {
  if (!newPrd) return [];

  const oldMap = new Map<string, UserStory>();
  if (oldPrd) {
    for (const s of oldPrd.userStories) {
      oldMap.set(s.id, s);
    }
  }

  const transitions: StoryTransition[] = [];
  for (const s of newPrd.userStories) {
    const prev = oldMap.get(s.id);
    const prevStatus = prev ? storyStatus(prev) : "new";
    const currStatus = storyStatus(s);

    if (prevStatus !== currStatus) {
      transitions.push({
        id: s.id,
        title: s.title,
        from: prevStatus,
        to: currStatus,
      });
    }
  }

  return transitions;
}

async function readPrdAtCommit(
  bareRepo: string,
  commit: string,
): Promise<PRD | null> {
  try {
    const result = await exec(
      ["git", "show", `${commit}:prd.json`],
      { cwd: bareRepo },
    );
    if (result.success) {
      return JSON.parse(result.stdout);
    }
  } catch {
    // prd.json may not exist at this commit
  }
  return null;
}

export const changesTool = {
  name: "ralph_changes",
  description:
    "Get what changed since a previous commit — new commits, story transitions, new log entries, and container changes. Use this for follow-up checks instead of ralph_status to see only deltas.",
  params: {
    project_dir: z
      .string()
      .describe("Absolute path to the project directory"),
    since_commit: z
      .string()
      .optional()
      .describe(
        "Commit hash to diff from (returned as latest_commit from previous calls). Defaults to initial commit.",
      ),
  },

  async handler(args: {
    project_dir: string;
    since_commit?: string;
  }): Promise<string> {
    const { project_dir } = args;
    const bareRepo = `${project_dir}/.ralph/repo.git`;
    const logsDir = `${project_dir}/agent_logs`;

    // Resolve since_commit — fallback to initial commit of bare repo
    let sinceCommit = args.since_commit;
    if (!sinceCommit) {
      const initResult = await exec(
        ["git", "rev-list", "--max-parents=0", "HEAD"],
        { cwd: bareRepo },
      );
      sinceCommit = initResult.success
        ? initResult.stdout.trim().split("\n")[0]
        : "HEAD";
    }

    // Resolve latest_commit
    const headResult = await exec(["git", "rev-parse", "HEAD"], {
      cwd: bareRepo,
    });
    const latestCommit = headResult.success
      ? headResult.stdout.trim()
      : "unknown";

    // Get the timestamp of since_commit for log file filtering
    const sinceTimestampResult = await exec(
      ["git", "show", "-s", "--format=%ct", sinceCommit],
      { cwd: bareRepo },
    );
    const sinceTimestamp = sinceTimestampResult.success
      ? parseInt(sinceTimestampResult.stdout.trim(), 10) * 1000
      : 0;

    // Run remaining queries in parallel
    const [commitsResult, oldPrd, newPrd, dockerResult, logEntries] =
      await Promise.all([
        // New commits since the given commit
        exec(
          ["git", "log", "--oneline", `${sinceCommit}..HEAD`, "--all"],
          { cwd: bareRepo },
        ).catch(() => ({ success: false, stdout: "", stderr: "", code: 1 })),

        // PRD at since_commit
        readPrdAtCommit(bareRepo, sinceCommit),

        // Current PRD
        readPrdAtCommit(bareRepo, "HEAD"),

        // Docker containers
        exec([
          "docker",
          "ps",
          "--filter",
          "name=ralph-",
          "--format",
          "{{.Names}}\t{{.Status}}\t{{.RunningFor}}",
        ]).catch(() => ({ success: false, stdout: "", stderr: "", code: 1 })),

        // Log files modified since the commit timestamp
        scanNewLogs(logsDir, sinceTimestamp),
      ]);

    // Parse commits
    const newCommits = commitsResult.success
      ? commitsResult.stdout
          .trim()
          .split("\n")
          .filter((l) => l.length > 0)
          .map((line) => {
            const spaceIdx = line.indexOf(" ");
            return {
              hash: line.substring(0, spaceIdx),
              message: line.substring(spaceIdx + 1),
            };
          })
      : [];

    // Diff stories
    const storyTransitions = diffStories(oldPrd, newPrd);

    // Parse containers
    const containers: ContainerInfo[] = dockerResult.success
      ? dockerResult.stdout
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => {
            const [name, status, running_for] = line.split("\t");
            return { name, status, running_for };
          })
      : [];

    // Flag containers that started after since_commit
    const likelyNew = containers
      .filter((c) => {
        // "Up X seconds/minutes" — containers with short uptime are likely new
        const match = c.running_for.match(
          /(\d+)\s*(second|minute|hour|day)/,
        );
        if (!match) return false;
        const val = parseInt(match[1], 10);
        const unit = match[2];
        const uptimeMs =
          val *
          (unit === "second"
            ? 1000
            : unit === "minute"
              ? 60_000
              : unit === "hour"
                ? 3_600_000
                : 86_400_000);
        const sinceDuration = Date.now() - sinceTimestamp;
        return uptimeMs < sinceDuration;
      })
      .map((c) => c.name);

    const result: ChangesResult = {
      project: project_dir,
      since_commit: sinceCommit,
      latest_commit: latestCommit,
      new_commits: newCommits,
      story_transitions: storyTransitions,
      new_log_entries: logEntries,
      containers: { current: containers, likely_new: likelyNew },
    };

    return JSON.stringify(result, null, 2);
  },
};

async function scanNewLogs(
  logsDir: string,
  sinceTimestamp: number,
): Promise<{ new_count: number; recent_summaries: LogEntry[] }> {
  const newFiles: { name: string; mtime: number }[] = [];

  try {
    for await (const entry of Deno.readDir(logsDir)) {
      if (entry.isFile && entry.name.endsWith(".log")) {
        const stat = await Deno.stat(`${logsDir}/${entry.name}`);
        const mtime = stat.mtime?.getTime() ?? 0;
        if (mtime > sinceTimestamp) {
          newFiles.push({ name: entry.name, mtime });
        }
      }
    }
  } catch {
    return { new_count: 0, recent_summaries: [] };
  }

  // Sort by mtime descending, take top 5
  newFiles.sort((a, b) => b.mtime - a.mtime);
  const top = newFiles.slice(0, 5);

  const summaries = await Promise.all(
    top.map(async ({ name }) => {
      const content = await Deno.readTextFile(`${logsDir}/${name}`);
      const lines = content.split("\n");
      const tail = lines.slice(-10).join("\n");
      return { file: name, last_lines: tail };
    }),
  );

  return { new_count: newFiles.length, recent_summaries: summaries };
}
