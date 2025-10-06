import { ENV } from '../config/env.js';
import type { Finding } from '../types/index.js';
import { HttpProxyAgent } from 'http-proxy-agent';
import http from 'http';

/**
 * Bitbucket Code Insights API Service
 *
 * Uses Code Insights API to display code review findings in Bitbucket PR.
 * Automatically authenticated when running in Bitbucket Pipelines via OIDC proxy.
 *
 * @see https://developer.atlassian.com/cloud/bitbucket/rest/api-group-reports/
 * @see https://support.atlassian.com/bitbucket-cloud/docs/integrate-pipelines-with-resource-servers-using-oidc/
 */

interface Annotation {
  annotation_type: 'BUG' | 'VULNERABILITY' | 'CODE_SMELL';
  summary: string;
  details?: string;
  path: string;
  line?: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  link?: string;
}

export class BitbucketService {
  private apiUrl: string;
  private workspace: string;
  private repoOwner: string;
  private repoSlug: string;
  private commit: string;
  private proxyAgent: HttpProxyAgent<string> | null = null;

  constructor() {
    this.workspace = ENV.BITBUCKET_WORKSPACE || '';
    this.repoOwner = ENV.BITBUCKET_REPO_OWNER || '';
    this.repoSlug = ENV.BITBUCKET_REPO_SLUG || '';
    this.commit = ENV.BITBUCKET_COMMIT || '';

    if (!this.workspace || !this.repoSlug || !this.commit) {
      throw new Error('Missing required Bitbucket environment variables');
    }

    // In Bitbucket Pipelines, use OIDC proxy for auto-authentication
    const isInPipeline = !!process.env.BITBUCKET_BUILD_NUMBER;

    if (isInPipeline) {
      // Use HTTP URL (not HTTPS) - OIDC proxy uses forward proxy, not CONNECT tunneling
      // Proxy intercepts HTTP requests and adds OIDC auth headers
      this.apiUrl = 'http://api.bitbucket.org/2.0';

      // Create HttpProxyAgent for http.request()
      // When using image: directly (not docker-in-docker), localhost works
      this.proxyAgent = new HttpProxyAgent('http://localhost:29418');

      console.log('🔐 Using Bitbucket OIDC proxy for authentication (HttpProxyAgent: http://localhost:29418)');
    } else {
      this.apiUrl = 'https://api.bitbucket.org/2.0';
      this.proxyAgent = null;
    }
  }

  /**
   * Create or update Code Insights report
   */
  async createReport(reportId: string, title: string, details: string, result: 'PASSED' | 'FAILED'): Promise<void> {
    const url = `${this.apiUrl}/repositories/${this.workspace}/${this.repoSlug}/commit/${this.commit}/reports/${reportId}`;

    console.log(`📊 Creating Code Insights report: ${reportId}`);

    const payload = {
      title,
      details,
      report_type: 'BUG',
      reporter: 'TheRevio',
      link: ENV.BITBUCKET_GIT_HTTP_ORIGIN || undefined,
      result,
    };

    const body = JSON.stringify(payload);

    if (ENV.DEBUG) {
      console.log(`[DEBUG] Create Report Request:`);
      console.log(`  URL: ${url}`);
      console.log(`  Method: PUT`);
      console.log(`  Using Proxy: ${this.proxyAgent ? 'yes (http://localhost:29418)' : 'no'}`);
      console.log(`  Payload: ${body}`);
    }

    try {

      // Parse URL
      const urlObj = new URL(url);

      const options: http.RequestOptions = {
        method: 'PUT',
        host: urlObj.hostname,
        port: urlObj.port || 80,
        path: urlObj.pathname + urlObj.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Host': urlObj.hostname,
        },
        agent: this.proxyAgent || undefined,
      };

      const responseData = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
        });

        req.on('error', reject);
        req.write(body);
        req.end();
      });

      if (ENV.DEBUG) {
        console.log(`[DEBUG] Create Report Response:`);
        console.log(`  Status: ${responseData.statusCode}`);
        console.log(`  Body: ${responseData.body}`);
      }

      if (responseData.statusCode !== 200 && responseData.statusCode !== 201) {
        console.error(`❌ Failed to create report: ${responseData.statusCode}`);
        console.error(`   Response: ${responseData.body}`);
        throw new Error(`Failed to create report: ${responseData.statusCode} ${responseData.body}`);
      }

      console.log(`✅ Report created: ${title}`);
    } catch (error: any) {
      console.error(`❌ Error creating report: ${error.message}`);
      if (error.cause) {
        console.error(`   Cause: ${JSON.stringify(error.cause)}`);
      }
      if (error.code) {
        console.error(`   Error code: ${error.code}`);
      }
      console.error(`   Full error:`, error);
      throw error;
    }
  }

  /**
   * Add annotations to Code Insights report
   * Uses PUT with unique ID for each annotation
   */
  async addAnnotations(reportId: string, annotations: Annotation[]): Promise<void> {
    if (annotations.length === 0) {
      console.log('⚠️  No annotations to add');
      return;
    }

    console.log(`📝 Adding ${annotations.length} annotation(s)`);

    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i];

      // Generate unique annotation ID from file path and line
      const annotationId = `ann-${annotation.path.replace(/[^a-zA-Z0-9]/g, '-')}-${annotation.line || 0}-${i}`;
      const url = `${this.apiUrl}/repositories/${this.workspace}/${this.repoSlug}/commit/${this.commit}/reports/${reportId}/annotations/${annotationId}`;

      try {
        const body = JSON.stringify(annotation);

        if (ENV.DEBUG) {
          console.log(`[DEBUG] Add Annotation ${i + 1}/${annotations.length} Request:`);
          console.log(`  URL: ${url}`);
          console.log(`  Method: PUT`);
          console.log(`  Payload: ${body}`);
        }

        const urlObj = new URL(url);

        const options: http.RequestOptions = {
          method: 'PUT',
          host: urlObj.hostname,
          port: urlObj.port || 80,
          path: urlObj.pathname + urlObj.search,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Host': urlObj.hostname,
          },
          agent: this.proxyAgent || undefined,
        };

        const responseData = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
          const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
          });

          req.on('error', reject);
          req.write(body);
          req.end();
        });

        if (ENV.DEBUG) {
          console.log(`[DEBUG] Add Annotation ${i + 1}/${annotations.length} Response:`);
          console.log(`  Status: ${responseData.statusCode}`);
          console.log(`  Body: ${responseData.body}`);
        }

        if (responseData.statusCode !== 200 && responseData.statusCode !== 201) {
          console.error(`❌ Failed to add annotation ${i + 1}: ${responseData.statusCode}`);
          console.error(`   Response: ${responseData.body}`);
          throw new Error(`Failed to add annotation ${i + 1}: ${responseData.statusCode} ${responseData.body}`);
        }
      } catch (error: any) {
        console.error(`❌ Error adding annotation ${i + 1}: ${error.message}`);
        throw error;
      }
    }

    console.log(`✅ All ${annotations.length} annotations added successfully`);
  }

  /**
   * Convert TheRevio findings to Bitbucket annotations
   */
  findingsToAnnotations(findings: Finding[]): Annotation[] {
    return findings.map(finding => {
      // Map severity
      let severity: Annotation['severity'];
      switch (finding.severity) {
        case 'critical':
          severity = 'CRITICAL';
          break;
        case 'error':
          severity = 'HIGH';
          break;
        case 'warning':
          severity = 'MEDIUM';
          break;
        case 'info':
        default:
          severity = 'LOW';
          break;
      }

      // Map annotation type based on rule name/severity
      let annotationType: Annotation['annotation_type'] = 'CODE_SMELL';
      if (finding.rule.toLowerCase().includes('security') || finding.rule.toLowerCase().includes('vulnerability')) {
        annotationType = 'VULNERABILITY';
      } else if (finding.severity === 'error' || finding.severity === 'critical') {
        annotationType = 'BUG';
      }

      // Build details with full message and recommendations
      let details = finding.message;

      if (finding.suggestion) {
        details += `\n\n💡 **Recommendation:**\n${finding.suggestion}`;
      }

      return {
        annotation_type: annotationType,
        summary: finding.rule,
        details,
        path: finding.file,
        line: finding.line,
        severity,
      };
    });
  }

  /**
   * Publish findings to Bitbucket PR
   */
  async publishFindings(findings: Finding[]): Promise<void> {
    const reportId = 'therevio-review';

    // Determine result
    const hasCritical = findings.some(f => f.severity === 'critical' || f.severity === 'error');
    const result = hasCritical ? 'FAILED' : 'PASSED';

    // Create report
    const title = `TheRevio Code Review`;
    const details = `Found ${findings.length} issue${findings.length === 1 ? '' : 's'}\n\n` +
      `Critical: ${findings.filter(f => f.severity === 'critical').length}\n` +
      `Errors: ${findings.filter(f => f.severity === 'error').length}\n` +
      `Warnings: ${findings.filter(f => f.severity === 'warning').length}\n` +
      `Info: ${findings.filter(f => f.severity === 'info').length}`;

    await this.createReport(reportId, title, details, result);

    // Add annotations
    const annotations = this.findingsToAnnotations(findings);
    await this.addAnnotations(reportId, annotations);

    console.log(`🎉 Successfully published ${findings.length} findings to Bitbucket PR`);
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
