import * as schema from '@core/models';
import { FastifyRedis } from '@fastify/redis';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { LoggerService } from '@core/services/logger.service';
import { TFunction } from 'i18next';
import { Connection, Client as ClientTemporal } from '@temporalio/client';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PermissionsRoles } from '@core/common/enums/permissions';
import { ITokenJwtData } from '@core/common/interfaces/ITokenJwtData';
import { ITokenKeyData } from '@core/common/interfaces/ITokenKeyData';
import { ITokenTfaData } from '@core/common/interfaces/ITokenTfaData';
import { ELanguage } from '../enums/ELanguage';
import { Client as ClientElastic } from '@elastic/elasticsearch';
import { Kafka } from 'kafkajs';

declare module 'fastify' {
  export interface FastifyRequest {
    module: ERouteModule;
  }

  export interface FastifyInstance {
    Database: NodePgDatabase<typeof schema>;
    DatabaseElasticClient: ClientElastic;
    ElasticLogsClient: ClientElastic;
    Kafka: Kafka;
    redis: FastifyRedis;
    logger: LoggerService;
    authenticateJwt: (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions: PermissionsRoles[] | null
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
    tokenKeyData: ITokenKeyData;
    tokenJwtData: ITokenJwtData;
    tokenTfaData: ITokenTfaData;
    permissionsRoute: PermissionsRoles[];
    module: ERouteModule;
    languageData: {
      code: ELanguage;
      id: number;
    };
  }
}
