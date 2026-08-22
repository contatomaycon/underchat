import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
  quiet: true,
});

import { BaileysEnvironment } from './BaileysEnvironment';
import { BalanceEnvironment } from './BalanceEnvironment';
import { CacheEnvironment } from './CacheEnvironment';
import { CentrifugoEnvironment } from './CentrifugoEnvironment';
import { DatabaseElasticEnvironment } from './DatabaseElasticEnvironment';
import { GeneralEnvironment } from './GeneralEnvironment';
import { KafkaEnvironment } from './KafkaEnvironment';
import { S3Environment } from './S3Environment';
import { WwebjsEnvironment } from './WwebjsEnvironment';

/**
 * Database-free environment composition root for channel workers.
 *
 * Worker tsconfigs map the public `@core/config/environments` import to this
 * module. This preserves the existing import API while making it impossible
 * for a worker build to include or instantiate the Balance-only PostgreSQL
 * environment.
 */
export const generalEnvironment = new GeneralEnvironment();
export const cacheEnvironment = new CacheEnvironment();
export const databaseElasticEnvironment = new DatabaseElasticEnvironment();
export const centrifugoEnvironment = new CentrifugoEnvironment();
export const baileysEnvironment = new BaileysEnvironment();
export const wwebjsEnvironment = new WwebjsEnvironment();
export const kafkaEnvironment = new KafkaEnvironment();
export const balanceEnvironment = new BalanceEnvironment();
export const s3Environment = new S3Environment();
