import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './packages/models/index.ts',
  dialect: 'postgresql',
});
