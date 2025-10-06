import { readFile } from 'fs/promises';
import { join } from 'path';
import { ENV } from '../config/env.js';
import { DependenciesResult } from '../types/index.js';

export class DependenciesService {
  private repoPath: string;

  constructor() {
    this.repoPath = ENV.REPO_PATH;
  }

  /**
   * Detect and parse dependencies from various package managers
   */
  async getDependencies(): Promise<DependenciesResult> {
    // Try to detect package manager
    const packageManager = await this.detectPackageManager();

    let manifestFiles: string[] = [];
    let dependencies: Record<string, string> = {};

    switch (packageManager) {
      case 'npm':
      case 'yarn':
      case 'pnpm':
        manifestFiles = ['package.json'];
        dependencies = await this.parseNodeDependencies();
        break;

      case 'pip':
        manifestFiles = ['requirements.txt', 'setup.py', 'pyproject.toml'];
        dependencies = await this.parsePythonDependencies();
        break;

      case 'maven':
        manifestFiles = ['pom.xml'];
        dependencies = await this.parseMavenDependencies();
        break;

      case 'gradle':
        manifestFiles = ['build.gradle', 'build.gradle.kts'];
        dependencies = await this.parseGradleDependencies();
        break;

      default:
        manifestFiles = [];
        dependencies = {};
    }

    return {
      packageManager,
      manifestFiles,
      dependencies,
    };
  }

  /**
   * Detect package manager from lock files and manifests
   */
  private async detectPackageManager(): Promise<DependenciesResult['packageManager']> {
    const checks = [
      { file: 'package-lock.json', manager: 'npm' as const },
      { file: 'yarn.lock', manager: 'yarn' as const },
      { file: 'pnpm-lock.yaml', manager: 'pnpm' as const },
      { file: 'requirements.txt', manager: 'pip' as const },
      { file: 'pom.xml', manager: 'maven' as const },
      { file: 'build.gradle', manager: 'gradle' as const },
    ];

    for (const { file, manager } of checks) {
      try {
        await readFile(join(this.repoPath, file));
        return manager;
      } catch {
        continue;
      }
    }

    return 'unknown';
  }

  /**
   * Parse Node.js dependencies from package.json
   */
  private async parseNodeDependencies(): Promise<Record<string, string>> {
    try {
      const packageJson = await readFile(
        join(this.repoPath, 'package.json'),
        'utf-8'
      );
      const pkg = JSON.parse(packageJson);

      return {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
    } catch {
      return {};
    }
  }

  /**
   * Parse Python dependencies from requirements.txt
   */
  private async parsePythonDependencies(): Promise<Record<string, string>> {
    try {
      const requirements = await readFile(
        join(this.repoPath, 'requirements.txt'),
        'utf-8'
      );

      const deps: Record<string, string> = {};

      requirements.split('\n').forEach(line => {
        const match = line.match(/^([a-zA-Z0-9-_]+)([=<>]=?)(.+)$/);
        if (match) {
          deps[match[1]] = match[3];
        }
      });

      return deps;
    } catch {
      return {};
    }
  }

  /**
   * Parse Maven dependencies from pom.xml
   */
  private async parseMavenDependencies(): Promise<Record<string, string>> {
    try {
      const pom = await readFile(join(this.repoPath, 'pom.xml'), 'utf-8');
      const deps: Record<string, string> = {};

      // Simple regex-based parsing (for MVP)
      const depMatches = pom.matchAll(
        /<dependency>[\s\S]*?<groupId>(.*?)<\/groupId>[\s\S]*?<artifactId>(.*?)<\/artifactId>[\s\S]*?<version>(.*?)<\/version>/g
      );

      for (const match of depMatches) {
        const [, group, artifact, version] = match;
        deps[`${group}:${artifact}`] = version;
      }

      return deps;
    } catch {
      return {};
    }
  }

  /**
   * Parse Gradle dependencies from build.gradle
   */
  private async parseGradleDependencies(): Promise<Record<string, string>> {
    try {
      const gradle = await readFile(
        join(this.repoPath, 'build.gradle'),
        'utf-8'
      );
      const deps: Record<string, string> = {};

      // Simple regex-based parsing (for MVP)
      const depMatches = gradle.matchAll(
        /(?:implementation|api|compile|testImplementation)\s+['"]([^'"]+)['"]/g
      );

      for (const match of depMatches) {
        const [, dep] = match;
        const parts = dep.split(':');
        if (parts.length >= 3) {
          deps[`${parts[0]}:${parts[1]}`] = parts[2];
        }
      }

      return deps;
    } catch {
      return {};
    }
  }
}
