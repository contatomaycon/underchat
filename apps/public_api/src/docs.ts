import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { enrichPublicOpenApi } from '@core/common/functions/enrichPublicOpenApi';
import { buildPublicServer } from '@/index';
import { validatePublicOpenApi } from '@/openapi/validatePublicOpenApi';

process.env.APP_ENVIRONMENT ??= 'LOCAL';
process.env.APP_URL_PUBLIC ??= 'localhost:3001';

const server = buildPublicServer({ infrastructure: false, logger: false });

try {
  await server.ready();
  const document = enrichPublicOpenApi(server.swagger());
  validatePublicOpenApi(document);

  const outputDirectory = resolve(process.cwd(), 'dist');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, 'openapi.json'),
    `${JSON.stringify(document, null, 2)}\n`,
    'utf8'
  );
} finally {
  await server.close();
}
