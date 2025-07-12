import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './packages/core/models/index.ts',
  dialect: 'postgresql',
});
