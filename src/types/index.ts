// Agent-to-Backend communication protocol

export interface AgentRegistration {
  workspace: string;
  repo: string;
  prId: string;
  prUrl?: string;
  commit: string;
  sourceBranch: string;
  destinationBranch: string;
  agentVersion: string;
  apiKey: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
}

export interface AgentCommand {
  commandId: string;
  type: 'read_file' | 'get_diff' | 'search' | 'list_files' | 'get_dependencies' | 'run_check';
  params: any;
}

export interface AgentResponse {
  commandId: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface FileReadParams {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface SearchParams {
  pattern: string;
  path?: string;
  filePattern?: string;
}

export interface DependenciesResult {
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'pip' | 'maven' | 'gradle' | 'unknown';
  manifestFiles: string[];
  dependencies: Record<string, string>;
}

export interface Finding {
  rule: string;
  severity: 'critical' | 'error' | 'warning' | 'info';
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}
