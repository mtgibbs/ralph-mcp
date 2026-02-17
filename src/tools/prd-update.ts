import { z } from "zod";
import { exec } from "../exec.ts";
import type { PRD, UserStory } from "../types.ts";

export const prdUpdateTool = {
  name: "ralph_prd_update",
  description:
    "Modify the PRD: add, edit, or remove stories. Changes are committed to the bare repo so running agents pick them up on their next pull.",
  params: {
    project_dir: z.string().describe("Absolute path to the project directory"),
    action: z.enum(["add_story", "edit_story", "remove_story"]).describe("The modification to make"),
    story: z.object({
      id: z.string().describe("Story ID (e.g. 'US-005')"),
      title: z.string().optional(),
      description: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      priority: z.number().optional(),
      notes: z.string().optional(),
      verified: z.boolean().optional(),
      verified_by: z.string().nullable().optional(),
      verified_at: z.string().nullable().optional(),
      verification_notes: z.string().nullable().optional(),
    }).describe("Story data. For add_story: full story object. For edit_story: id + fields to update. For remove_story: just id."),
  },

  async handler(args: {
    project_dir: string;
    action: "add_story" | "edit_story" | "remove_story";
    story: Partial<UserStory> & { id: string };
  }): Promise<string> {
    const { project_dir, action, story } = args;
    const bareRepo = `${project_dir}/.ralph/repo.git`;

    // Check bare repo exists
    try {
      await Deno.stat(bareRepo);
    } catch {
      return JSON.stringify({
        error: "No bare repo found at .ralph/repo.git — has ralph been run on this project?",
      });
    }

    // Read current PRD from bare repo
    const showResult = await exec(
      ["git", "show", "HEAD:prd.json"],
      { cwd: bareRepo },
    );
    if (!showResult.success) {
      return JSON.stringify({
        error: "Failed to read prd.json from bare repo",
        stderr: showResult.stderr.trim(),
      });
    }

    let prd: PRD;
    try {
      prd = JSON.parse(showResult.stdout);
    } catch {
      return JSON.stringify({ error: "Failed to parse prd.json" });
    }

    // Get the current branch name from bare repo
    const headResult = await exec(
      ["git", "symbolic-ref", "HEAD"],
      { cwd: bareRepo },
    );
    const branch = headResult.success
      ? headResult.stdout.trim().replace("refs/heads/", "")
      : "main";

    // Apply the modification
    let commitMessage: string;

    switch (action) {
      case "add_story": {
        if (!story.title || !story.description || !story.acceptanceCriteria) {
          return JSON.stringify({
            error: "add_story requires title, description, and acceptanceCriteria",
          });
        }
        const existing = prd.userStories.find((s) => s.id === story.id);
        if (existing) {
          return JSON.stringify({ error: `Story ${story.id} already exists` });
        }
        const newStory: UserStory = {
          id: story.id,
          title: story.title,
          description: story.description,
          acceptanceCriteria: story.acceptanceCriteria,
          priority: story.priority ??
            Math.max(0, ...prd.userStories.map((s) => s.priority)) + 1,
          passes: false,
          notes: story.notes ?? "",
          claimed_by: null,
          claimed_at: null,
          verified: false,
          verified_by: null,
          verified_at: null,
          verification_notes: null,
        };
        prd.userStories.push(newStory);
        commitMessage = `[mcp] Add story ${story.id}: ${story.title}`;
        break;
      }

      case "edit_story": {
        const idx = prd.userStories.findIndex((s) => s.id === story.id);
        if (idx === -1) {
          return JSON.stringify({ error: `Story ${story.id} not found` });
        }
        const existing = prd.userStories[idx];
        if (story.title !== undefined) existing.title = story.title;
        if (story.description !== undefined) existing.description = story.description;
        if (story.acceptanceCriteria !== undefined) existing.acceptanceCriteria = story.acceptanceCriteria;
        if (story.priority !== undefined) existing.priority = story.priority;
        if (story.notes !== undefined) existing.notes = story.notes;
        if (story.verified !== undefined) existing.verified = story.verified;
        if (story.verified_by !== undefined) existing.verified_by = story.verified_by;
        if (story.verified_at !== undefined) existing.verified_at = story.verified_at;
        if (story.verification_notes !== undefined) existing.verification_notes = story.verification_notes;
        prd.userStories[idx] = existing;

        const fields = Object.keys(story).filter((k) => k !== "id");
        commitMessage = `[mcp] Edit story ${story.id}: update ${fields.join(", ")}`;
        break;
      }

      case "remove_story": {
        const idx = prd.userStories.findIndex((s) => s.id === story.id);
        if (idx === -1) {
          return JSON.stringify({ error: `Story ${story.id} not found` });
        }
        const removed = prd.userStories.splice(idx, 1)[0];
        commitMessage = `[mcp] Remove story ${story.id}: ${removed.title}`;
        break;
      }

      default:
        return JSON.stringify({ error: `Unknown action: ${action}` });
    }

    // Write changes via temp checkout of bare repo
    const tmpDir = await Deno.makeTempDir({ prefix: "ralph-mcp-prd-" });
    try {
      const cloneResult = await exec([
        "git", "clone", "--branch", branch, bareRepo, tmpDir + "/work",
      ]);
      if (!cloneResult.success) {
        return JSON.stringify({
          error: "Failed to clone bare repo for update",
          stderr: cloneResult.stderr.trim(),
        });
      }

      const workDir = `${tmpDir}/work`;

      // Write updated prd.json
      await Deno.writeTextFile(
        `${workDir}/prd.json`,
        JSON.stringify(prd, null, 2) + "\n",
      );

      // Configure git user for this commit
      await exec(["git", "config", "user.email", "ralph-mcp@localhost"], { cwd: workDir });
      await exec(["git", "config", "user.name", "ralph-mcp"], { cwd: workDir });

      // Stage, commit, push
      await exec(["git", "add", "prd.json"], { cwd: workDir });

      const commitResult = await exec(
        ["git", "commit", "-m", commitMessage],
        { cwd: workDir },
      );
      if (!commitResult.success) {
        return JSON.stringify({
          error: "Failed to commit prd.json update",
          stderr: commitResult.stderr.trim(),
        });
      }

      const pushResult = await exec(
        ["git", "push", "origin", "HEAD"],
        { cwd: workDir },
      );
      if (!pushResult.success) {
        return JSON.stringify({
          error: "Failed to push update to bare repo",
          stderr: pushResult.stderr.trim(),
        });
      }

      return JSON.stringify(
        {
          success: true,
          action,
          story_id: story.id,
          commit_message: commitMessage,
          total_stories: prd.userStories.length,
        },
        null,
        2,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  },
};
