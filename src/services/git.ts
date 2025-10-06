import simpleGit, { SimpleGit } from 'simple-git';
import { FileDiff, DiffHunk } from '../types/index.js';
import { ENV } from '../config/env.js';

export class GitService {
  private git: SimpleGit;
  private repoPath: string;

  constructor() {
    this.repoPath = ENV.REPO_PATH;
    this.git = simpleGit(this.repoPath);
    // Fix "dubious ownership" error in Docker
    this.git.addConfig('safe.directory', this.repoPath, false, 'global');
  }

  /**
   * Get diff between source and destination branches
   */
  async getDiff(): Promise<FileDiff[]> {
    const destBranch = ENV.BITBUCKET_PR_DESTINATION_BRANCH || 'main';
    const sourceBranch = ENV.BITBUCKET_BRANCH || 'HEAD';

    try {
      // With clone: depth: full, all branches are already available locally
      // No need to fetch - origin/destBranch should already exist

      // Get diff with context
      const diffSummary = await this.git.diffSummary([
        `origin/${destBranch}...${sourceBranch}`,
      ]);

      const diffs: FileDiff[] = [];

      for (const file of diffSummary.files) {
        const rawDiff = await this.git.diff([
          `origin/${destBranch}...${sourceBranch}`,
          '--',
          file.file,
        ]);

        const hunks = this.parseDiffHunks(rawDiff);

        let status: FileDiff['status'] = 'modified';
        if (file.binary) {
          continue; // Skip binary files
        }
        if (diffSummary.insertions > 0 && diffSummary.deletions === 0) {
          status = 'added';
        } else if (diffSummary.deletions > 0 && diffSummary.insertions === 0) {
          status = 'deleted';
        }

        diffs.push({
          path: file.file,
          status,
          hunks,
        });
      }

      return diffs;
    } catch (error) {
      console.error('Error getting diff:', error);
      throw error;
    }
  }

  /**
   * Parse diff hunks from raw diff output
   */
  private parseDiffHunks(diffText: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = diffText.split('\n');

    let currentHunk: DiffHunk | null = null;

    for (const line of lines) {
      // Match hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);

      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          oldLines: parseInt(hunkMatch[2] || '1'),
          newStart: parseInt(hunkMatch[3]),
          newLines: parseInt(hunkMatch[4] || '1'),
          lines: [],
        };
      } else if (currentHunk) {
        currentHunk.lines.push(line);
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  /**
   * Get list of changed files
   */
  async getChangedFiles(): Promise<string[]> {
    const diffs = await this.getDiff();
    return diffs.map(d => d.path);
  }
}
