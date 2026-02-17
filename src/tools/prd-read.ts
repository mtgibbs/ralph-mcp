import { z } from "zod";
import { exec, resolveLatestPrdRef } from "../exec.ts";
import type { PRD } from "../types.ts";

export const prdReadTool = {
  name: "ralph_prd_read",
  description:
    "Read the current PRD (Product Requirements Document) with story statuses. Returns stories grouped by status: available, claimed, verifying, and done.",
  params: {
    project_dir: z.string().describe("Absolute path to the project directory"),
  },

  async handler(args: { project_dir: string }): Promise<string> {
    const { project_dir } = args;
    const prd = await readPrd(project_dir);

    if (!prd) {
      return JSON.stringify({
        error: "No prd.json found",
        searched: [
          `${project_dir}/.ralph/repo.git (bare repo)`,
          `${project_dir}/prd.json (working directory)`,
        ],
      });
    }

    const available = prd.userStories
      .filter((s) => !s.passes && !s.claimed_by)
      .sort((a, b) => a.priority - b.priority);
    const claimed = prd.userStories.filter((s) => !s.passes && s.claimed_by);
    const verifying = prd.userStories.filter((s) => s.passes && !s.verified);
    const done = prd.userStories.filter((s) => s.passes && s.verified);

    // Backward compat: if no stories have verified field, treat all passes=true as done
    const hasVerifiers = prd.userStories.some((s) => s.verified !== undefined);
    const effectiveDone = hasVerifiers ? done : prd.userStories.filter((s) => s.passes);
    const effectiveVerifying = hasVerifiers ? verifying : [];

    return JSON.stringify(
      {
        project: prd.project,
        branch: prd.branchName ?? null,
        description: prd.description ?? null,
        summary: {
          total: prd.userStories.length,
          available: available.length,
          claimed: claimed.length,
          verifying: effectiveVerifying.length,
          done: effectiveDone.length,
        },
        stories: {
          available: available.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            acceptanceCriteria: s.acceptanceCriteria,
            priority: s.priority,
            notes: s.notes || null,
            verification_notes: s.verification_notes || null,
          })),
          claimed: claimed.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            acceptanceCriteria: s.acceptanceCriteria,
            priority: s.priority,
            claimed_by: s.claimed_by,
            claimed_at: s.claimed_at,
            notes: s.notes || null,
            verification_notes: s.verification_notes || null,
          })),
          verifying: effectiveVerifying.map((s) => ({
            id: s.id,
            title: s.title,
            verified_by: s.verified_by ?? null,
            verification_notes: s.verification_notes ?? null,
          })),
          done: effectiveDone.map((s) => ({
            id: s.id,
            title: s.title,
          })),
        },
      },
      null,
      2,
    );
  },
};

async function readPrd(projectDir: string): Promise<PRD | null> {
  // Prefer bare repo (has latest agent pushes)
  // Use resolveLatestPrdRef to find the working branch, not HEAD (which points to main)
  const bareRepo = `${projectDir}/.ralph/repo.git`;
  try {
    await Deno.stat(bareRepo);
    const ref = await resolveLatestPrdRef(bareRepo);
    const result = await exec(
      ["git", "show", `${ref}:prd.json`],
      { cwd: bareRepo },
    );
    if (result.success) {
      return JSON.parse(result.stdout);
    }
  } catch {
    // Fall through to working directory
  }

  // Fall back to working directory
  try {
    const text = await Deno.readTextFile(`${projectDir}/prd.json`);
    return JSON.parse(text);
  } catch {
    return null;
  }
}
