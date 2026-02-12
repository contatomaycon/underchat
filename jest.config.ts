import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { compilerOptions } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, './tsconfig.json'), 'utf8')
) as { compilerOptions: { paths?: Record<string, string[]> } };

dotenv.config({ path: path.resolve(__dirname, './.env') });

const config: Config = {
  clearMocks: true,
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths ?? {}, {
    prefix: '<rootDir>/',
  }),
  modulePathIgnorePatterns: [
    '<rootDir>/out/',
    '<rootDir>/dist/',
    '<rootDir>/apps/.*/dist/',
  ],
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[tj]s?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/out/',
    '<rootDir>/dist/',
    '<rootDir>/apps/.*/dist/',
  ],
  passWithNoTests: true,
};

export default config;
