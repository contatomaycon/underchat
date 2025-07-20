import * as schema from '@core/models';
import { FastifyRedis } from '@fastify/redis';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { LoggerService } from '@core/services/logger.service';
import { TFunction } from 'i18next';
import { Connection, Client as ClientTemporal } from '@temporalio/client';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { ITokenJwtData } from '@core/common/interfaces/ITokenJwtData';
import { ELanguage } from '../enums/ELanguage';
import { Client as ClientElastic } from '@elastic/elasticsearch';
import { ITokenKeyData } from '../interfaces/ITokenKeyData';
import { KafkaStreams } from 'kafka-streams';
import { Centrifuge } from 'centrifuge';

declare module 'fastify' {
  export interface FastifyRequest {
    module: ERouteModule;
  }

  export interface FastifyInstance {
    Database: NodePgDatabase<typeof schema>;
    DatabaseElasticClient: ClientElastic;
    ElasticLogsClient: ClientElastic;
    KafkaStreams: KafkaStreams;
    Centrifuge: Centrifuge;
    redis: FastifyRedis;
    logger: LoggerService;
    authenticateJwt: (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions: EPermissionsRoles[] | null
    ) => void;
    authenticateKeyApi: (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions: EPermissionsRoles[] | null
    ) => void;
    verifyToken: (token: string) => Promise<null | string | object>;
    decodeToken: (token: string) => Promise<null | string | object>;
    i18n: TFunction<'translation', undefined>;
    temporal: {
      connection: Connection;
      client: ClientTemporal;
    };
  }

  export interface FastifyRequest {
    tokenJwtData: ITokenJwtData;
    tokenKeyData: ITokenKeyData;
    permissionsRoute: EPermissionsRoles[];
    module: ERouteModule;
    languageData: {
      code: ELanguage;
      id: number;
    };
  }
}
