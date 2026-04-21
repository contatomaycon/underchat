import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('repositories/index', () => {
  it('is currently an empty file', () => {
    const filePath = resolve(process.cwd(), 'packages/repositories/index.ts');
    const content = readFileSync(filePath, 'utf8');

    expect(content.trim()).toBe('');
  });
});
