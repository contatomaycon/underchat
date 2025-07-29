import { CacheEnvironment } from './CacheEnvironment';
import { DatabaseEnvironment } from './DatabaseEnvironment';
import { GeneralEnvironment } from './GeneralEnvironment';
import { ElasticSearchEnvironment } from './ElasticSearchEnvironment';
import { DatabaseElasticEnvironment } from './DatabaseElasticEnvironment';
import { KafkaEnvironment } from './KafkaEnvironment';
import { CentrifugoEnvironment } from './CentrifugoEnvironment';
import { BaileysEnvironment } from './BaileysEnvironment';

export const generalEnvironment = new GeneralEnvironment();
export const databaseEnvironment = new DatabaseEnvironment();
export const cacheEnvironment = new CacheEnvironment();
export const elasticSearchEnvironment = new ElasticSearchEnvironment();
export const databaseElasticEnvironment = new DatabaseElasticEnvironment();
export const kafkaEnvironment = new KafkaEnvironment();
export const centrifugoEnvironment = new CentrifugoEnvironment();
export const baileysEnvironment = new BaileysEnvironment();
