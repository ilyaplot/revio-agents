import { ENV } from '../config/env.js';
import type { Finding } from '../types/index.js';

/**
 * GitHub Checks API and PR Review Comments Service
 *
 * Uses GitHub Checks API to display code review summary and
 * PR Review Comments API to add inline code comments.
 *
 * @see https://docs.github.com/en/rest/checks/runs
 * @see https://docs.github.com/en/rest/pulls/comments
 */

interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title: string;
  raw_details?: string;
}

export class GitHubService {
  private token: string;
  private apiUrl: string;
  private repository: string;
  private owner: string;
  private repo: string;
  private sha: string;

  constructor() {
    this.token = process.env.GITHUB_TOKEN || '';
    this.apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
    this.repository = process.env.GITHUB_REPOSITORY || '';
    this.sha = process.env.GITHUB_SHA || '';

    if (!this.token || !this.repository || !this.sha) {
      throw new Error('Missing required GitHub environment variables');
    }

    // Split owner/repo
    const parts = this.repository.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid GITHUB_REPOSITORY format: ${this.repository}`);
    }
    this.owner = parts[0];
    this.repo = parts[1];

    console.log('🔐 Using GitHub API with token authentication');
  }

  /**
   * Create a Check Run for the commit
   */
  async createCheckRun(name: string, status: 'queued' | 'in_progress' | 'completed'): Promise<number> {
    const url = `${this.apiUrl}/repos/${this.owner}/${this.repo}/check-runs`;

    console.log(`📊 Creating Check Run: ${name}`);

    const payload: any = {
      name,
      head_sha: this.sha,
      status,
    };

    if (status === 'completed') {
      payload.conclusion = 'neutral';
      payload.completed_at = new Date().toISOString();
    }

    const response = await this.makeRequest('POST', url, payload);
    const data: any = await response.json();

    if (!response.ok) {
      console.error(`❌ Failed to create check run: ${response.status}`);
      console.error(`   Response: ${JSON.stringify(data)}`);
      throw new Error(`Failed to create check run: ${response.status} ${JSON.stringify(data)}`);
    }

    console.log(`✅ Check Run created: ${name} (ID: ${data.id})`);
    return data.id;
  }

  /**
   * Update a Check Run with results
   */
  async updateCheckRun(
    checkRunId: number,
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled',
    title: string,
    summary: string,
    annotations: Annotation[] = []
  ): Promise<void> {
    const url = `${this.apiUrl}/repos/${this.owner}/${this.repo}/check-runs/${checkRunId}`;

    console.log(`📝 Updating Check Run ${checkRunId} with ${annotations.length} annotations`);

    // GitHub API limits annotations to 50 per request
    const annotationBatches = this.chunkArray(annotations, 50);

    for (let i = 0; i < annotationBatches.length; i++) {
      const batch = annotationBatches[i];
      const isLastBatch = i === annotationBatches.length - 1;

      const payload: any = {
        status: 'completed',
        conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title,
          summary,
          annotations: batch,
        },
      };

      if (ENV.DEBUG) {
        console.log(`[DEBUG] Update Check Run Request (batch ${i + 1}/${annotationBatches.length}):`);
        console.log(`  URL: ${url}`);
        console.log(`  Payload: ${JSON.stringify(payload, null, 2)}`);
      }

      const response = await this.makeRequest('PATCH', url, payload);
      const data = await response.json();

      if (ENV.DEBUG) {
        console.log(`[DEBUG] Update Check Run Response:`);
        console.log(`  Status: ${response.status}`);
        console.log(`  Body: ${JSON.stringify(data)}`);
      }

      if (!response.ok) {
        console.error(`❌ Failed to update check run: ${response.status}`);
        console.error(`   Response: ${JSON.stringify(data)}`);
        throw new Error(`Failed to update check run: ${response.status} ${JSON.stringify(data)}`);
      }

      console.log(`✅ Check Run updated (batch ${i + 1}/${annotationBatches.length})`);
    }
  }

  /**
   * Get Pull Request number from commit
   */
  async getPRNumber(): Promise<number | null> {
    // For pull_request events, extract from GITHUB_REF (refs/pull/123/merge)
    const ref = process.env.GITHUB_REF || '';
    const prMatch = ref.match(/refs\/pull\/(\d+)\//);
    if (prMatch) {
      return parseInt(prMatch[1], 10);
    }

    // Fallback: search for PR by commit SHA
    const url = `${this.apiUrl}/repos/${this.owner}/${this.repo}/commits/${this.sha}/pulls`;

    try {
      const response = await this.makeRequest('GET', url);
      const pulls = await response.json();

      if (Array.isArray(pulls) && pulls.length > 0) {
        return pulls[0].number;
      }
    } catch (error: any) {
      console.warn(`⚠️  Failed to get PR number: ${error.message}`);
    }

    return null;
  }

  /**
   * Add review comments to PR
   */
  async addReviewComments(prNumber: number, findings: Finding[]): Promise<void> {
    console.log(`💬 Adding ${findings.length} review comments to PR #${prNumber}`);

    const url = `${this.apiUrl}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/comments`;

    for (let i = 0; i < findings.length; i++) {
      const finding = findings[i];

      const body = `**${finding.rule}** (${finding.severity})\n\n${finding.message}` +
        (finding.suggestion ? `\n\n💡 **Recommendation:**\n${finding.suggestion}` : '');

      const payload = {
        body,
        commit_id: this.sha,
        path: finding.file,
        line: finding.line,
        side: 'RIGHT', // Comment on the new version of the file
      };

      try {
        if (ENV.DEBUG) {
          console.log(`[DEBUG] Add Review Comment ${i + 1}/${findings.length}:`);
          console.log(`  Payload: ${JSON.stringify(payload, null, 2)}`);
        }

        const response = await this.makeRequest('POST', url, payload);
        const data = await response.json();

        if (!response.ok) {
          console.error(`❌ Failed to add review comment ${i + 1}: ${response.status}`);
          console.error(`   Response: ${JSON.stringify(data)}`);
          // Don't throw - continue with other comments
        } else {
          console.log(`✅ Review comment ${i + 1}/${findings.length} added`);
        }
      } catch (error: any) {
        console.error(`❌ Error adding review comment ${i + 1}: ${error.message}`);
        // Continue with other comments
      }
    }

    console.log(`🎉 Review comments processing completed`);
  }

  /**
   * Convert TheRevio findings to GitHub Check annotations
   */
  findingsToAnnotations(findings: Finding[]): Annotation[] {
    return findings.map(finding => {
      // Map severity to annotation level
      let level: Annotation['annotation_level'];
      switch (finding.severity) {
        case 'critical':
        case 'error':
          level = 'failure';
          break;
        case 'warning':
          level = 'warning';
          break;
        case 'info':
        default:
          level = 'notice';
          break;
      }

      // Build raw details with full message and recommendations
      let rawDetails = finding.message;
      if (finding.suggestion) {
        rawDetails += `\n\n💡 Recommendation:\n${finding.suggestion}`;
      }

      return {
        path: finding.file,
        start_line: finding.line,
        end_line: finding.line,
        annotation_level: level,
        title: finding.rule,
        message: finding.message,
        raw_details: rawDetails,
      };
    });
  }

  /**
   * Publish findings to GitHub PR
   */
  async publishFindings(findings: Finding[]): Promise<void> {
    const checkRunName = 'TheRevio Code Review';

    // Create Check Run
    const checkRunId = await this.createCheckRun(checkRunName, 'in_progress');

    // Determine conclusion
    const hasCritical = findings.some(f => f.severity === 'critical' || f.severity === 'error');
    const conclusion = hasCritical ? 'failure' : 'success';

    // Build summary
    const title = `Found ${findings.length} issue${findings.length === 1 ? '' : 's'}`;
    const summary =
      `**Critical:** ${findings.filter(f => f.severity === 'critical').length}\n` +
      `**Errors:** ${findings.filter(f => f.severity === 'error').length}\n` +
      `**Warnings:** ${findings.filter(f => f.severity === 'warning').length}\n` +
      `**Info:** ${findings.filter(f => f.severity === 'info').length}`;

    // Convert to annotations
    const annotations = this.findingsToAnnotations(findings);

    // Update Check Run with results
    await this.updateCheckRun(checkRunId, conclusion, title, summary, annotations);

    // Try to add inline PR comments
    try {
      const prNumber = await this.getPRNumber();
      if (prNumber) {
        await this.addReviewComments(prNumber, findings);
      } else {
        console.log('ℹ️  No PR found for this commit - skipping inline comments');
      }
    } catch (error: any) {
      console.error(`⚠️  Failed to add PR comments: ${error.message}`);
      // Don't fail the review if PR comments fail
    }

    console.log(`🎉 Successfully published ${findings.length} findings to GitHub`);
  }

  /**
   * Make authenticated GitHub API request
   */
  private async makeRequest(method: string, url: string, body?: any): Promise<Response> {
    const options: RequestInit = {
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TheRevio-Agent-GitHub',
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
    };

    return fetch(url, options);
  }

  /**
   * Helper: Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
