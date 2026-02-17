import type { ExecResult } from "./types.ts";

/**
 * Execute a shell command and capture output.
 * Returns structured result with stdout, stderr, and exit code.
 */
export async function exec(
  cmd: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<ExecResult> {
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: options?.cwd,
    env: options?.env ? { ...Deno.env.toObject(), ...options.env } : undefined,
    stdout: "piped",
    stderr: "piped",
  });

  const process = await command.output();
  const stdout = new TextDecoder().decode(process.stdout);
  const stderr = new TextDecoder().decode(process.stderr);

  return {
    success: process.success,
    stdout,
    stderr,
    code: process.code,
  };
}

/**
 * Execute a shell command in the background (fire-and-forget).
 * Returns the spawned process so caller can track it if needed.
 */
export function execBackground(
  cmd: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Deno.ChildProcess {
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: options?.cwd,
    env: options?.env ? { ...Deno.env.toObject(), ...options.env } : undefined,
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });

  return command.spawn();
}

/** Resolve the ralph installation directory */
export function getRalphHome(): string {
  return Deno.env.get("RALPH_HOME") ??
    new URL("../../ralph", import.meta.url).pathname;
}

/**
 * Resolve the ref containing the latest prd.json in a bare repo.
 * Agents push to a working branch (e.g. ralph/string-utils), not main,
 * so bare-repo HEAD (which points to main) is stale.
 */
export async function resolveLatestPrdRef(bareRepo: string): Promise<string> {
  const result = await exec(
    ["git", "log", "--all", "-1", "--format=%H", "--", "prd.json"],
    { cwd: bareRepo },
  );
  if (result.success && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return "HEAD";
}

/**
 * Resolve the latest commit across all branches in a bare repo.
 */
export async function resolveLatestCommit(bareRepo: string): Promise<string> {
  const result = await exec(
    ["git", "log", "--all", "-1", "--format=%H"],
    { cwd: bareRepo },
  );
  if (result.success && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return "unknown";
}
