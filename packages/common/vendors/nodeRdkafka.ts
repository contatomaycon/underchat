import { createRequire } from 'node:module';
import path from 'node:path';

const cjsRequire = createRequire(path.join(process.cwd(), 'package.json'));

export const rdkafka = cjsRequire(
  'node-rdkafka'
) as typeof import('node-rdkafka');
