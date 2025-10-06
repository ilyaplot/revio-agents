import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { ENV } from '../config/env.js';
import type { Finding } from '../types/index.js';

class XMLBuilder {
  private indent: string = '';
  private lines: string[] = [];

  constructor() {
    this.lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  }

  openTag(name: string, attrs: Record<string, string | number> = {}): this {
    const attrStr = Object.entries(attrs)
      .map(([key, value]) => `${key}="${this.escapeAttr(String(value))}"`)
      .join(' ');

    this.lines.push(`${this.indent}<${name}${attrStr ? ' ' + attrStr : ''}>`);
    this.indent += '  ';
    return this;
  }

  closeTag(name: string): this {
    this.indent = this.indent.slice(0, -2);
    this.lines.push(`${this.indent}</${name}>`);
    return this;
  }

  addCData(content: string): this {
    this.lines.push(`${this.indent}<![CDATA[${content}]]>`);
    return this;
  }

  addText(text: string): this {
    this.lines.push(`${this.indent}${this.escapeText(text)}`);
    return this;
  }

  build(): string {
    return this.lines.join('\n');
  }

  private escapeAttr(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapeText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

/**
 * Generate JUnit XML report from findings
 * Bitbucket Pipelines automatically parses JUnit XML files
 */
export function generateJUnitReport(findings: Finding[]): string {
  const failures = findings.filter(f => f.severity === 'error' || f.severity === 'critical').length;
  const skipped = findings.filter(f => f.severity === 'warning').length;
  const total = findings.length;

  const xml = new XMLBuilder();

  xml.openTag('testsuites');
  xml.openTag('testsuite', {
    name: 'TheRevio Code Review',
    tests: total,
    failures: failures,
    skipped: skipped,
    time: 0
  });

  findings.forEach((finding) => {
    const testName = `${finding.file}:${finding.line} - ${finding.rule}`;
    const className = finding.file.replace(/\//g, '.');

    xml.openTag('testcase', {
      name: testName,
      classname: className,
      time: 0
    });

    let fullMessage = finding.message;
    if (finding.suggestion) {
      fullMessage += '\n\nSuggestion: ' + finding.suggestion;
    }

    if (finding.severity === 'error' || finding.severity === 'critical') {
      xml.openTag('failure', {
        message: finding.message,
        type: finding.severity
      });
      xml.addCData(fullMessage);
      xml.closeTag('failure');
    } else if (finding.severity === 'warning') {
      xml.openTag('skipped', {
        message: finding.message
      });
      xml.addCData(fullMessage);
      xml.closeTag('skipped');
    } else {
      xml.openTag('system-out');
      xml.addCData(fullMessage);
      xml.closeTag('system-out');
    }

    xml.closeTag('testcase');
  });

  xml.closeTag('testsuite');
  xml.closeTag('testsuites');

  return xml.build();
}

/**
 * Write JUnit report to file
 * Bitbucket Pipelines will automatically detect it in test-results/ directory
 */
export function writeJUnitReport(findings: Finding[]): void {
  const xml = generateJUnitReport(findings);
  const outputPath = `${ENV.REPO_PATH}/test-results/therevio-junit.xml`;

  try {
    // Ensure directory exists
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(outputPath, xml, 'utf-8');
    console.log(`📄 JUnit report written to: ${outputPath}`);
  } catch (error: any) {
    console.error(`❌ Failed to write JUnit report: ${error.message}`);
  }
}
