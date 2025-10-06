import { WebSocketService } from './services/websocket.js';
import { BitbucketService } from './services/bitbucket.js';
import { writeJUnitReport } from './services/junit.js';
import { ENV } from './config/env.js';
import type { Finding } from './types/index.js';

async function main() {
  console.log('🚀 TheRevio Agent starting...');
  console.log('📦 Version:', ENV.AGENT_VERSION);
  console.log('📂 BITBUCKET_REPO_OWNER:', ENV.BITBUCKET_REPO_OWNER);
  console.log('📂 BITBUCKET_WORKSPACE:', ENV.BITBUCKET_WORKSPACE);
  console.log('📂 BITBUCKET_REPO_SLUG:', ENV.BITBUCKET_REPO_SLUG);
  console.log('🔀 BITBUCKET_PR_ID:', ENV.BITBUCKET_PR_ID);
  console.log('📝 BITBUCKET_COMMIT:', ENV.BITBUCKET_COMMIT);
  console.log(`⏱️  Review timeout: ${ENV.REVIEW_TIMEOUT / 1000}s`);

  const wsService = new WebSocketService(ENV);
  let bitbucketService: BitbucketService | null = null;
  let reviewCompleted = false;
  let idleTimeout: NodeJS.Timeout | null = null;
  let pendingBitbucketPublish: Promise<void> | null = null;

  // Initialize Bitbucket service if running in Pipelines
  if (process.env.BITBUCKET_BUILD_NUMBER) {
    try {
      bitbucketService = new BitbucketService();
      console.log('✅ Bitbucket Code Insights integration enabled');
    } catch (error: any) {
      console.warn(`⚠️  Bitbucket integration disabled: ${error.message}`);
    }
  } else {
    console.log('ℹ️  Not running in Bitbucket Pipelines - Code Insights integration disabled');
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

      // Write JUnit report for Bitbucket Pipelines test reports
      if (process.env.BITBUCKET_BUILD_NUMBER) {
        try {
          writeJUnitReport(findings);
        } catch (error: any) {
          console.error(`❌ Failed to write JUnit report: ${error.message}`);
        }
      }

      // Publish to Code Insights API
      if (bitbucketService) {
        console.log('📊 Publishing to Bitbucket Code Insights...');
        // Start publishing but don't await here - save promise to wait later
        pendingBitbucketPublish = (async () => {
          try {
            await bitbucketService.publishFindings(findings);
            console.log('✅ Findings published to Bitbucket Code Insights');
          } catch (error: any) {
            console.error(`❌ Failed to publish to Bitbucket: ${error.message}`);
            console.error(`   Stack: ${error.stack}`);
            // Don't fail the review if Bitbucket publishing fails
          }
        })();
      } else {
        console.log('ℹ️  Bitbucket integration not available - skipping Code Insights');
      }
    });

    // Listen for review completion
    wsService.onReviewComplete(async () => {
      reviewCompleted = true;
      clearTimeout(reviewTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
      console.log('✅ Review completed successfully');

      // Wait for Bitbucket publishing to complete (if any)
      if (pendingBitbucketPublish) {
        console.log('⏳ Waiting for Bitbucket Code Insights publishing to complete...');
        try {
          await Promise.race([
            pendingBitbucketPublish,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Bitbucket publish timeout')), 30000))
          ]);
        } catch (error: any) {
          console.error(`⚠️  Bitbucket publishing timed out or failed: ${error.message}`);
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
