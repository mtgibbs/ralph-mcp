/** A single user story in the PRD */
export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes?: string;
  claimed_by?: string | null;
  claimed_at?: string | null;
  verified?: boolean;
  verified_by?: string | null;
  verified_at?: string | null;
  verification_notes?: string | null;
}

/** The full PRD document */
export interface PRD {
  project: string;
  branchName?: string;
  description?: string;
  userStories: UserStory[];
}

/** Result from shell execution */
export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}
