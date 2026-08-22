/** @jest-config-loader esbuild-register */
import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const { compilerOptions } = JSON.parse(
  fs.readFileSync(path.resolve(currentDirectory, './tsconfig.json'), 'utf8')
) as { compilerOptions: { paths?: Record<string, string[]> } };
const pathAliases = pathsToModuleNameMapper(compilerOptions.paths ?? {}, {
  prefix: '<rootDir>/',
});

dotenv.config({ path: path.resolve(currentDirectory, './.env') });

const config: Config = {
  clearMocks: true,
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  maxWorkers: process.env.JEST_MAX_WORKERS ?? '25%',
  moduleNameMapper: {
    '^file-type$': '<rootDir>/packages/tests/mocks/file-type.ts',
    '^socks-proxy-agent$':
      '<rootDir>/packages/tests/mocks/socks-proxy-agent.ts',
    '^uuid$': '<rootDir>/packages/tests/mocks/uuid.ts',
    ...pathAliases,
  },
  modulePathIgnorePatterns: [
    '<rootDir>/out/',
    '<rootDir>/dist/',
    '<rootDir>/apps/.*/dist/',
    '<rootDir>/packages/tests/e2e/',
  ],
  openHandlesTimeout: 5000,
  roots: ['<rootDir>/packages/tests', '<rootDir>/apps/mobile'],
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[tj]s?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/out/',
    '<rootDir>/dist/',
    '<rootDir>/apps/.*/dist/',
    '<rootDir>/packages/tests/e2e/',
  ],
  workerGracefulExitTimeout: 15000,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: process.env.JEST_TS_DIAGNOSTICS === 'true',
        tsconfig: '<rootDir>/tsconfig.jest.json',
      },
    ],
  },
  passWithNoTests: true,
};

export default config;
