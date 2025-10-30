import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './@core/models/index.ts',
  dialect: 'postgresql',
});
