import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const AGENT_VERSION = packageJson.version;

/**
 * Base environment configuration for TheRevio agents
 * Platform-specific agents should extend this
 */
export interface BaseEnv {
  // Backend connection
  BACKEND_URL: string;
  API_KEY: string;

  // Agent metadata
  AGENT_VERSION: string;

  // Repository path
  REPO_PATH: string;

  // Timeouts (in milliseconds)
  CONNECTION_TIMEOUT: number;
  REVIEW_TIMEOUT: number;
  COMMAND_TIMEOUT: number;
  IDLE_TIMEOUT: number;

  // Modes
  FAIL_SAFE: boolean;
  DEBUG: boolean;

  // CI/CD platform variables (optional, filled by platform-specific implementations)
  BITBUCKET_WORKSPACE?: string;
  BITBUCKET_REPO_SLUG?: string;
  BITBUCKET_REPO_OWNER?: string;
  BITBUCKET_PR_ID?: string;
  BITBUCKET_COMMIT?: string;
  BITBUCKET_BRANCH?: string;
  BITBUCKET_PR_DESTINATION_BRANCH?: string;
  BITBUCKET_GIT_HTTP_ORIGIN?: string;
}

export const BASE_ENV: BaseEnv = {
  // Backend connection
  BACKEND_URL: process.env.BACKEND_URL || 'ws://localhost:3001',
  API_KEY: process.env.THEREVIO_API_KEY || '',

  // Agent metadata (read from package.json at build time)
  AGENT_VERSION,

  // Repository path
  REPO_PATH: process.env.REPO_PATH || process.cwd(),

  // Timeouts
  CONNECTION_TIMEOUT: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),
  REVIEW_TIMEOUT: parseInt(process.env.REVIEW_TIMEOUT || '300000'),
  COMMAND_TIMEOUT: parseInt(process.env.COMMAND_TIMEOUT || '60000'),
  IDLE_TIMEOUT: parseInt(process.env.IDLE_TIMEOUT || '600000'),

  // Modes
  FAIL_SAFE: process.env.FAIL_SAFE === 'true',
  DEBUG: process.env.DEBUG === '1' || process.env.DEBUG === 'true',
};

// For backward compatibility - services expect ENV
export const ENV = BASE_ENV;
