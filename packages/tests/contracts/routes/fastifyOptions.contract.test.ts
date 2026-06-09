import fs from 'node:fs';
import path from 'node:path';

const appsDir = path.resolve(process.cwd(), 'apps');

const fastifyIndexFiles = fs
  .readdirSync(appsDir)
  .map((appName) => path.join(appsDir, appName, 'src/index.ts'))
  .filter((indexPath) => fs.existsSync(indexPath))
  .filter((indexPath) =>
    fs.readFileSync(indexPath, 'utf8').includes('fastify({')
  );

describe('Fastify app options', () => {
  it('keeps router maxParamLength under routerOptions in every Fastify app', () => {
    expect(fastifyIndexFiles.length).toBeGreaterThan(0);

    for (const indexPath of fastifyIndexFiles) {
      const source = fs.readFileSync(indexPath, 'utf8');

      expect(source).toContain('routerOptions: {');
      expect(source).toContain('maxParamLength: 2048');
      expect(source).not.toContain('\n  maxParamLength: 2048,');
    }
  });
});
