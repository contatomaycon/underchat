import * as schema from '@core/models';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { TFunction } from 'i18next';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { ITokenJwtData } from '@core/common/interfaces/ITokenJwtData';
import { ELanguage } from '../enums/ELanguage';
import { Client as ClientElastic } from '@elastic/elasticsearch';
import { ITokenKeyData } from '../interfaces/ITokenKeyData';
import { Centrifuge } from 'centrifuge';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import Redis from 'ioredis';
import { IRegisterJwtData } from '../interfaces/IRegisterJwtData';
import type { Pool } from 'pg';
import { IPublicApiTokenData } from '../interfaces/IPublicApiTokenData';
import type { PublicApiPermissionRequirements } from './PublicApiPermissionRequirements';

declare module 'fastify' {
  export interface FastifyRequest {
    module: ERouteModule;
    rawBody?: Buffer;
  }

  export interface FastifyInstance {
    DatabaseRw: NodePgDatabase<typeof schema>;
    DatabaseRo: NodePgDatabase<typeof schema>;
    DatabasePoolRw: Pool;
    DatabasePoolRo: Pool;
    DatabaseElasticClient: ClientElastic;
    ElasticLogsClient: ClientElastic;
    Centrifuge: Centrifuge;
    Kafka: KafkaClient;
    Redis: Redis;
    qrStreamReady: boolean;
    authenticateJwt: (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions?: EPermissionsRoles[] | null
    ) => Promise<void>;
    authenticateKeyApi: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    authenticatePublicApiToken: (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions?: PublicApiPermissionRequirements | null
    ) => Promise<void>;
    authenticatePublicApiAccountToken: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    authenticateRegisterJwt: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    verifyToken: (token: string) => Promise<null | string | object>;
    decodeToken: (token: string) => Promise<null | string | object>;
    i18n: TFunction<'translation', undefined>;
    baileysInitialized: Promise<void>;
    wwebjsInitialized: Promise<void>;
  }

  export interface FastifyRequest {
    tokenJwtData: ITokenJwtData;
    tokenKeyData: ITokenKeyData;
    registerJwtData: IRegisterJwtData;
    publicApiTokenData: IPublicApiTokenData;
    publicApiAuthenticationCompleted?: boolean;
    integrationEntitlementRevision?: string;
    integrationEntitlementSource?: 'plan' | 'addon' | null;
    permissionsRoute: PublicApiPermissionRequirements | null;
    module: ERouteModule;
    languageData: {
      code: ELanguage;
      id: number;
    };
  }
}
