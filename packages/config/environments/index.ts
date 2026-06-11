import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
  quiet: true,
});

import { CacheEnvironment } from './CacheEnvironment';
import { DatabaseEnvironment } from './DatabaseEnvironment';
import { GeneralEnvironment } from './GeneralEnvironment';
import { DatabaseElasticEnvironment } from './DatabaseElasticEnvironment';
import { CentrifugoEnvironment } from './CentrifugoEnvironment';
import { BaileysEnvironment } from './BaileysEnvironment';
import { WwebjsEnvironment } from './WwebjsEnvironment';
import { KafkaEnvironment } from './KafkaEnvironment';
import { BalanceEnvironment } from './BalanceEnvironment';
import { S3Environment } from './S3Environment';
import { AsaasEnvironment } from './AsaasEnvironment';
import { SmtpEnvironment } from './SmtpEnvironment';
import { VapidEnvironment } from './VapidEnvironment';
import { BuildEnvironment } from './BuildEnvironment';
import { WorkerPoolEnvironment } from './WorkerPoolEnvironment';

export const generalEnvironment = new GeneralEnvironment();
export const databaseEnvironment = new DatabaseEnvironment();
export const cacheEnvironment = new CacheEnvironment();
export const databaseElasticEnvironment = new DatabaseElasticEnvironment();
export const centrifugoEnvironment = new CentrifugoEnvironment();
export const baileysEnvironment = new BaileysEnvironment();
export const wwebjsEnvironment = new WwebjsEnvironment();
export const kafkaEnvironment = new KafkaEnvironment();
export const balanceEnvironment = new BalanceEnvironment();
export const s3Environment = new S3Environment();
export const asaasEnvironment = new AsaasEnvironment();
export const smtpEnvironment = new SmtpEnvironment();
export const vapidEnvironment = new VapidEnvironment();
export const buildEnvironment = new BuildEnvironment();
export const workerPoolEnvironment = new WorkerPoolEnvironment();
