import * as schema from '@core/models';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { TFunction } from 'i18next';
import { Connection, Client as ClientTemporal } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
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

declare module 'fastify' {
  export interface FastifyRequest {
    module: ERouteModule;
  }

  export interface FastifyInstance {
    DatabaseRw: NodePgDatabase<typeof schema>;
    DatabaseRo: NodePgDatabase<typeof schema>;
    DatabaseElasticClient: ClientElastic;
    ElasticLogsClient: ClientElastic;
    Centrifuge: Centrifuge;
    Kafka: KafkaClient;
    Redis: Redis;
    authenticateJwt: (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions?: EPermissionsRoles[] | null
    ) => Promise<void>;
    authenticateKeyApi: (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions: EPermissionsRoles[] | null
    ) => Promise<void>;
    authenticateRegisterJwt: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    verifyToken: (token: string) => Promise<null | string | object>;
    decodeToken: (token: string) => Promise<null | string | object>;
    i18n: TFunction<'translation', undefined>;
    temporal: {
      connection: Connection;
      client: ClientTemporal;
      nativeConnection: NativeConnection;
    };
  }

  export interface FastifyRequest {
    tokenJwtData: ITokenJwtData;
    tokenKeyData: ITokenKeyData;
    registerJwtData: IRegisterJwtData;
    permissionsRoute: EPermissionsRoles[] | null;
    module: ERouteModule;
    languageData: {
      code: ELanguage;
      id: number;
    };
  }
}
