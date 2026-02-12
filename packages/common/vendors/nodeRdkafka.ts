import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const rdkafka = require('node-rdkafka') as typeof import('node-rdkafka');
