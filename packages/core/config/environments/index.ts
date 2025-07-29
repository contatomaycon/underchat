import { CacheEnvironment } from './CacheEnvironment';
import { DatabaseEnvironment } from './DatabaseEnvironment';
import { GeneralEnvironment } from './GeneralEnvironment';
import { ElasticSearchEnvironment } from './ElasticSearchEnvironment';
import { DatabaseElasticEnvironment } from './DatabaseElasticEnvironment';
import { CentrifugoEnvironment } from './CentrifugoEnvironment';
import { BaileysEnvironment } from './BaileysEnvironment';
import { RabbitMQEnvironment } from './RabbitMQEnvironment';

export const generalEnvironment = new GeneralEnvironment();
export const databaseEnvironment = new DatabaseEnvironment();
export const cacheEnvironment = new CacheEnvironment();
export const elasticSearchEnvironment = new ElasticSearchEnvironment();
export const databaseElasticEnvironment = new DatabaseElasticEnvironment();
export const centrifugoEnvironment = new CentrifugoEnvironment();
export const baileysEnvironment = new BaileysEnvironment();
export const rabbitMQEnvironment = new RabbitMQEnvironment();
