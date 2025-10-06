import { WebSocketService } from './services/websocket.js';
import { GitHubService } from './services/github.js';
import { ENV } from './config/env.js';
import type { Finding } from './types/index.js';

async function main() {
  console.log('🚀 TheRevio Agent starting...');
  console.log('📦 Version:', ENV.AGENT_VERSION);
  console.log('📂 GITHUB_REPOSITORY:', process.env.GITHUB_REPOSITORY);
  console.log('📝 GITHUB_SHA:', process.env.GITHUB_SHA);
  console.log('🔀 GITHUB_REF:', process.env.GITHUB_REF);
  console.log('📋 GITHUB_EVENT_NAME:', process.env.GITHUB_EVENT_NAME);
  console.log(`⏱️  Review timeout: ${ENV.REVIEW_TIMEOUT / 1000}s`);

  const wsService = new WebSocketService(ENV);
  let githubService: GitHubService | null = null;
  let reviewCompleted = false;
  let idleTimeout: NodeJS.Timeout | null = null;
  let pendingGitHubPublish: Promise<void> | null = null;

  // Initialize GitHub service if running in Actions
  if (process.env.GITHUB_ACTIONS === 'true') {
    try {
      githubService = new GitHubService();
      console.log('✅ GitHub Checks API integration enabled');
    } catch (error: any) {
      console.warn(`⚠️  GitHub integration disabled: ${error.message}`);
    }
  } else {
    console.log('ℹ️  Not running in GitHub Actions - Checks API integration disabled');
  }

  const exitWithError = (message: string) => {
    console.error(message);
    if (ENV.FAIL_SAFE) {
      console.log('⚠️  FAIL_SAFE mode enabled - exiting with success code despite error');
      process.exit(0);
    } else {
      process.exit(1);
    }
  };

  const resetIdleTimeout = () => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }
    idleTimeout = setTimeout(() => {
      wsService.disconnect();
      exitWithError(`❌ Idle timeout after ${ENV.IDLE_TIMEOUT / 1000}s - no activity from backend`);
    }, ENV.IDLE_TIMEOUT);
  };

  try {
    // Connect to backend with timeout
    const connectTimeout = setTimeout(() => {
      exitWithError(`❌ Connection timeout after ${ENV.CONNECTION_TIMEOUT / 1000}s`);
    }, ENV.CONNECTION_TIMEOUT);

    await wsService.connect();
    clearTimeout(connectTimeout);

    // Agent will remain connected and wait for commands
    console.log('⏳ Agent ready, waiting for commands from backend...');
    console.log(`⏱️  Idle timeout: ${ENV.IDLE_TIMEOUT / 1000}s`);

    // Start idle timeout
    resetIdleTimeout();

    // Set overall review timeout
    const reviewTimeout = setTimeout(() => {
      if (!reviewCompleted) {
        if (idleTimeout) clearTimeout(idleTimeout);
        wsService.disconnect();
        exitWithError(`❌ Review timeout after ${ENV.REVIEW_TIMEOUT / 1000}s`);
      }
    }, ENV.REVIEW_TIMEOUT);

    // Reset idle timeout on any activity from backend
    wsService.onActivity(() => {
      resetIdleTimeout();
    });

    // Handle critical errors
    wsService.onCriticalError((error: string) => {
      clearTimeout(reviewTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
      wsService.disconnect();
      exitWithError(`❌ Critical error: ${error}`);
    });

    // Listen for findings from backend
    wsService.onFindings((findings: Finding[]) => {
      console.log(`📊 Received ${findings.length} findings`);

      // Publish to GitHub Checks API
      if (githubService) {
        console.log('📊 Publishing to GitHub Checks API...');
        // Start publishing but don't await here - save promise to wait later
        pendingGitHubPublish = (async () => {
          try {
            await githubService.publishFindings(findings);
            console.log('✅ Findings published to GitHub Checks API');
          } catch (error: any) {
            console.error(`❌ Failed to publish to GitHub: ${error.message}`);
            console.error(`   Stack: ${error.stack}`);
            // Don't fail the review if GitHub publishing fails
          }
        })();
      } else {
        console.log('ℹ️  GitHub integration not available - skipping Checks API');
      }
    });

    // Listen for review completion
    wsService.onReviewComplete(async () => {
      reviewCompleted = true;
      clearTimeout(reviewTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
      console.log('✅ Review completed successfully');

      // Wait for GitHub publishing to complete (if any)
      if (pendingGitHubPublish) {
        console.log('⏳ Waiting for GitHub Checks API publishing to complete...');
        try {
          await Promise.race([
            pendingGitHubPublish,
            new Promise((_, reject) => setTimeout(() => reject(new Error('GitHub publish timeout')), 30000))
          ]);
        } catch (error: any) {
          console.error(`⚠️  GitHub publishing timed out or failed: ${error.message}`);
        }
      }

      wsService.disconnect();
      process.exit(0);
    });

    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n⚠️  Received SIGINT, shutting down...');
      clearTimeout(reviewTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
      wsService.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n⚠️  Received SIGTERM, shutting down...');
      clearTimeout(reviewTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
      wsService.disconnect();
      process.exit(0);
    });

  } catch (error: any) {
    exitWithError(`❌ Agent failed: ${error.message}`);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  if (ENV.FAIL_SAFE) {
    console.log('⚠️  FAIL_SAFE mode enabled - exiting with success code despite error');
    process.exit(0);
  } else {
    process.exit(1);
  }
});
