import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import { ENV } from '../config/env.js';

export class FileSystemService {
  private repoPath: string;

  constructor() {
    this.repoPath = ENV.REPO_PATH;
  }

  /**
   * Read file content (optionally with line range)
   */
  async readFile(
    path: string,
    startLine?: number,
    endLine?: number
  ): Promise<string> {
    const fullPath = join(this.repoPath, path);

    try {
      await access(fullPath);
      const content = await readFile(fullPath, 'utf-8');

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split('\n');
        const start = (startLine || 1) - 1;
        const end = endLine || lines.length;
        return lines.slice(start, end).join('\n');
      }

      return content;
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error}`);
    }
  }

  /**
   * Search for pattern in files
   */
  async search(
    pattern: string,
    searchPath?: string,
    filePattern?: string
  ): Promise<Array<{ file: string; line: number; content: string }>> {
    const results: Array<{ file: string; line: number; content: string }> = [];

    const globPattern = filePattern || '**/*';
    const basePath = searchPath ? join(this.repoPath, searchPath) : this.repoPath;

    const files = await glob(globPattern, {
      cwd: basePath,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
      nodir: true,
    });

    const regex = new RegExp(pattern, 'gi');

    for (const file of files) {
      try {
        const content = await this.readFile(file);
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            results.push({
              file,
              line: index + 1,
              content: line.trim(),
            });
          }
        });
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    return results;
  }

  /**
   * List files matching pattern
   */
  async listFiles(pattern: string = '**/*'): Promise<string[]> {
    const files = await glob(pattern, {
      cwd: this.repoPath,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
      nodir: true,
    });

    return files;
  }
}
