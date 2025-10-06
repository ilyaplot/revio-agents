import { io, Socket } from 'socket.io-client';
import { BaseEnv } from '../config/env.js';
import {
  AgentRegistration,
  AgentCommand,
  AgentResponse,
  FileReadParams,
  SearchParams,
} from '../types/index.js';
import { GitService } from './git.js';
import { FileSystemService } from './filesystem.js';
import { DependenciesService } from './dependencies.js';

export class WebSocketService {
  private socket: Socket | null = null;
  private gitService: GitService;
  private fsService: FileSystemService;
  private depsService: DependenciesService;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reviewCompleteCallback: (() => void) | null = null;
  private activityCallback: (() => void) | null = null;
  private criticalErrorCallback: ((error: string) => void) | null = null;
  private findingsCallback: ((findings: any[]) => void) | null = null;
  private ENV: BaseEnv;

  constructor(env: BaseEnv) {
    this.ENV = env;
    this.gitService = new GitService();
    this.fsService = new FileSystemService();
    this.depsService = new DependenciesService();
  }

  /**
   * Set callback for review completion
   */
  onReviewComplete(callback: () => void): void {
    this.reviewCompleteCallback = callback;
  }

  /**
   * Set callback for any activity from backend
   */
  onActivity(callback: () => void): void {
    this.activityCallback = callback;
  }

  /**
   * Set callback for critical errors that require process termination
   */
  onCriticalError(callback: (error: string) => void): void {
    this.criticalErrorCallback = callback;
  }

  /**
   * Set callback for receiving findings from backend
   */
  onFindings(callback: (findings: any[]) => void): void {
    this.findingsCallback = callback;
  }

  /**
   * Connect to backend and register agent
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`🔌 Connecting to backend: ${this.ENV.BACKEND_URL}`);

      this.socket = io(this.ENV.BACKEND_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 2000,
      });

      this.socket.on('connect', () => {
        console.log('✅ Connected to backend');
        this.reconnectAttempts = 0;
        this.registerAgent();
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('❌ Connection error:', error.message);
        this.reconnectAttempts++;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(new Error('Max reconnection attempts reached'));
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.log('💤 Disconnected:', reason);
      });

      this.socket.on('agent:command', (command: AgentCommand) => {
        if (this.activityCallback) this.activityCallback();

        if (this.ENV.DEBUG) {
          console.log(`[DEBUG] Received command from backend:`);
          console.log(`  Type: ${command.type}`);
          console.log(`  Command ID: ${command.commandId}`);
          console.log(`  Params: ${JSON.stringify(command.params)}`);
        }

        this.handleCommand(command);
      });

      this.socket.on('agent:registered', (data: any) => {
        console.log('✅ Agent registered:', data);
        if (this.activityCallback) this.activityCallback();
      });

      this.socket.on('review:complete', () => {
        console.log('✅ Review complete signal received from backend');
        if (this.activityCallback) this.activityCallback();
        if (this.reviewCompleteCallback) {
          this.reviewCompleteCallback();
        }
      });

      this.socket.on('review:findings', (findings: any[]) => {
        console.log(`📊 Received ${findings.length} findings from backend`);

        if (this.ENV.DEBUG) {
          console.log(`[DEBUG] Received findings from backend:`);
          console.log(`  Count: ${findings.length}`);
          console.log(`  Findings: ${JSON.stringify(findings, null, 2)}`);
        }

        if (this.activityCallback) this.activityCallback();
        if (this.findingsCallback) {
          this.findingsCallback(findings);
        }
      });

      this.socket.on('error', (error) => {
        console.error('❌ Socket error:', error);
      });

      this.socket.on('agent:error', (data: { error: string; message: string }) => {
        console.error('❌ Agent error from backend:');
        console.error(`   Error: ${data.error}`);
        console.error(`   ${data.message}`);
        // Call critical error callback to terminate the process
        if (this.criticalErrorCallback) {
          this.criticalErrorCallback(data.error);
        }
      });
    });
  }

  /**
   * Generate PR URL from environment variables (supports GitHub and Bitbucket)
   */
  private generatePrUrl(): string | undefined {
    // GitHub Actions
    if (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY) {
      const prMatch = process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)\//);
      if (prMatch) {
        return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/pull/${prMatch[1]}`;
      }
    }

    // Bitbucket Pipelines
    if (!this.ENV.BITBUCKET_PR_ID) {
      return undefined;
    }

    // Try to use BITBUCKET_GIT_HTTP_ORIGIN if available
    if (this.ENV.BITBUCKET_GIT_HTTP_ORIGIN) {
      // BITBUCKET_GIT_HTTP_ORIGIN example: https://bitbucket.org/workspace/repo
      return `${this.ENV.BITBUCKET_GIT_HTTP_ORIGIN}/pull-requests/${this.ENV.BITBUCKET_PR_ID}`;
    }

    // Fallback: construct from workspace and repo
    if (this.ENV.BITBUCKET_WORKSPACE && this.ENV.BITBUCKET_REPO_SLUG) {
      return `https://bitbucket.org/${this.ENV.BITBUCKET_WORKSPACE}/${this.ENV.BITBUCKET_REPO_SLUG}/pull-requests/${this.ENV.BITBUCKET_PR_ID}`;
    }

    return undefined;
  }

  /**
   * Register agent with backend (supports GitHub Actions and Bitbucket Pipelines)
   */
  private registerAgent(): void {
    let workspace = '';
    let repo = '';
    let prId = '';
    let commit = '';
    let sourceBranch = '';
    let destinationBranch = 'main';

    if (this.ENV.DEBUG) {
      console.log('[DEBUG] Environment detection:');
      console.log(`  GITHUB_ACTIONS: ${process.env.GITHUB_ACTIONS}`);
      console.log(`  GITHUB_REPOSITORY: ${process.env.GITHUB_REPOSITORY}`);
      console.log(`  GITHUB_REF: ${process.env.GITHUB_REF}`);
      console.log(`  GITHUB_SHA: ${process.env.GITHUB_SHA}`);
    }

    // Detect platform from environment variables
    if (process.env.GITHUB_ACTIONS === 'true') {
      // GitHub Actions environment
      if (this.ENV.DEBUG) {
        console.log('[DEBUG] Detected GitHub Actions platform');
      }

      const githubRepo = process.env.GITHUB_REPOSITORY || '';
      const parts = githubRepo.split('/');
      workspace = parts[0] || '';
      repo = parts[1] || '';

      const prMatch = process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)\//);
      prId = prMatch ? prMatch[1] : '';

      commit = process.env.GITHUB_SHA || '';
      sourceBranch = process.env.GITHUB_HEAD_REF || '';
      destinationBranch = process.env.GITHUB_BASE_REF || 'main';
    } else {
      // Bitbucket Pipelines environment
      if (this.ENV.DEBUG) {
        console.log('[DEBUG] Detected Bitbucket Pipelines platform');
      }

      workspace = this.ENV.BITBUCKET_WORKSPACE || '';
      repo = this.ENV.BITBUCKET_REPO_SLUG || '';
      prId = this.ENV.BITBUCKET_PR_ID || '';
      commit = this.ENV.BITBUCKET_COMMIT || '';
      sourceBranch = this.ENV.BITBUCKET_BRANCH || '';
      destinationBranch = this.ENV.BITBUCKET_PR_DESTINATION_BRANCH || 'main';
    }

    const registration: AgentRegistration = {
      workspace,
      repo,
      prId,
      prUrl: this.generatePrUrl(),
      commit,
      sourceBranch,
      destinationBranch,
      agentVersion: this.ENV.AGENT_VERSION,
      apiKey: this.ENV.API_KEY,
    };

    console.log('📝 Registering agent with backend');

    if (this.ENV.DEBUG) {
      console.log(`[DEBUG] Agent registration data:`);
      console.log(`  ${JSON.stringify(registration, null, 2)}`);
    }

    this.socket?.emit('agent:register', registration);
  }

  /**
   * Handle commands from backend
   */
  private async handleCommand(command: AgentCommand): Promise<void> {
    console.log(`📥 Received command: ${command.type} (${command.commandId})`);

    // Critical commands that must succeed for agent to function
    const criticalCommands = ['get_diff'];

    let response: AgentResponse;

    try {
      let data: any;

      switch (command.type) {
        case 'read_file':
          data = await this.handleReadFile(command.params as FileReadParams);
          break;

        case 'get_diff':
          data = await this.handleGetDiff();
          break;

        case 'search':
          data = await this.handleSearch(command.params as SearchParams);
          break;

        case 'list_files':
          data = await this.handleListFiles(command.params);
          break;

        case 'get_dependencies':
          data = await this.handleGetDependencies();
          break;

        default:
          throw new Error(`Unknown command type: ${command.type}`);
      }

      response = {
        commandId: command.commandId,
        success: true,
        data,
      };
    } catch (error: any) {
      console.error(`❌ Command failed: ${error.message}`);
      response = {
        commandId: command.commandId,
        success: false,
        error: error.message,
      };

      // If critical command failed, terminate agent
      if (criticalCommands.includes(command.type)) {
        if (this.criticalErrorCallback) {
          this.criticalErrorCallback(`Critical command '${command.type}' failed: ${error.message}`);
        }
      }
    }

    if (this.ENV.DEBUG) {
      console.log(`[DEBUG] Sending response to backend:`);
      console.log(`  Command ID: ${response.commandId}`);
      console.log(`  Success: ${response.success}`);
      if (response.success) {
        console.log(`  Data length: ${JSON.stringify(response.data).length} bytes`);
      } else {
        console.log(`  Error: ${response.error}`);
      }
    }

    this.socket?.emit('agent:response', response);
  }

  /**
   * Handle read_file command
   */
  private async handleReadFile(params: FileReadParams): Promise<string> {
    const { path, startLine, endLine } = params;
    return await this.fsService.readFile(path, startLine, endLine);
  }

  /**
   * Handle get_diff command
   */
  private async handleGetDiff(): Promise<any> {
    return await this.gitService.getDiff();
  }

  /**
   * Handle search command
   */
  private async handleSearch(params: SearchParams): Promise<any> {
    const { pattern, path, filePattern } = params;
    return await this.fsService.search(pattern, path, filePattern);
  }

  /**
   * Handle list_files command
   */
  private async handleListFiles(params: any): Promise<string[]> {
    const pattern = params?.pattern || '**/*';
    return await this.fsService.listFiles(pattern);
  }

  /**
   * Handle get_dependencies command
   */
  private async handleGetDependencies(): Promise<any> {
    return await this.depsService.getDependencies();
  }

  /**
   * Send findings to backend
   */
  sendFindings(findings: any[]): void {
    console.log(`📤 Sending ${findings.length} findings to backend`);
    this.socket?.emit('agent:findings', findings);
  }

  /**
   * Disconnect from backend
   */
  disconnect(): void {
    if (this.socket) {
      console.log('👋 Disconnecting from backend');
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
