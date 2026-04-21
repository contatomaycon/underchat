import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ISummaryProvider interface contract', () => {
  it('declares the expected generateSummary signature', () => {
    const filePath = resolve(
      process.cwd(),
      'packages/services/summary/ISummaryProvider.ts'
    );
    const content = readFileSync(filePath, 'utf8');

    expect(content).toContain('export interface ISummaryProvider');
    expect(content).toContain('generateSummary(');
    expect(content).toContain('): Promise<string>');
  });
});
