import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import fastify, { type FastifyInstance, type RouteOptions } from 'fastify';
import multipartFile from '@fastify/multipart';
import { v7 as uuidv7 } from 'uuid';
import fastifyQs from 'fastify-qs';
import dbConnector from '@core/config/database';
import { generalEnvironment } from '@core/config/environments';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { safePlugin } from '@core/common/functions/safePlugin';
import authenticateKeyApi from '@core/middlewares/keyapi.middleware';
import authenticatePublicApiToken from '@core/middlewares/publicApiToken.middleware';
import i18nextPlugin from '@core/plugins/i18next';
import corsPlugin from '@core/plugins/cors';
import jwtPlugin from '@core/plugins/jwt';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import centrifugoPlugin from '@core/plugins/centrifugo';
import redisPlugin from '@core/plugins/redis';
import s3Plugin from '@core/plugins/s3';
import swaggerPlugin from '@/plugins/swagger';
import routes from '@/routes';
import planEntitlementTelemetryPlugin from '@core/plugins/planEntitlementTelemetry';
import { publicApiErrorHandler } from '@core/common/functions/publicApiErrorHandler';

export interface PublicServerBuildOptions {
  infrastructure?: boolean;
  logger?: boolean;
}

function operationIdForRoute(route: RouteOptions): string {
  const method = Array.isArray(route.method) ? route.method[0] : route.method;
  const normalizedPath = route.url
    .replace(/^\/+|\/+$/g, '')
    .replace(/[:{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${String(method).toLowerCase()}_${normalizedPath || 'root'}`;
}

function tagForRoute(url: string): string | null {
  if (url.includes('/health/')) return 'Health';
  if (url.includes('/webhook/')) return 'Webhook';
  if (url.includes('/chat')) return 'Chat';
  if (url.includes('/label-template')) return 'Etiquetas';
  if (url.includes('/sector')) return 'Setores';
  if (url.includes('/user')) return 'Usuários';
  return null;
}

function addOpenApiRouteMetadata(server: FastifyInstance): void {
  server.addHook('onRoute', (route) => {
    const schema = route.schema as Record<string, unknown> | undefined;
    if (!schema || schema.hide === true) return;

    schema.operationId ??= operationIdForRoute(route);
    schema.summary ??= schema.description;

    const tag = tagForRoute(route.url);
    if (tag) schema.tags = [tag];
  });
}

export function buildPublicServer(
  options: PublicServerBuildOptions = {}
): FastifyInstance {
  const withInfrastructure = options.infrastructure !== false;
  const server = fastify({
    pluginTimeout: 600_000,
    connectionTimeout: 600_000,
    keepAliveTimeout: 600_000,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    routerOptions: {
      maxParamLength: 2048,
    },
    genReqId: () => uuidv7(),
    logger:
      options.logger === false
        ? false
        : {
            level: 'info',
            redact: {
              paths: [
                'req.headers.keyapi',
                'request.headers.keyapi',
                'headers.keyapi',
              ],
              censor: '[Redacted]',
            },
          },
  });

  server.setErrorHandler(publicApiErrorHandler);

  server.decorateRequest('module', ERouteModule.public);
  addOpenApiRouteMetadata(server);

  if (withInfrastructure) {
    server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
      module: ERouteModule.public,
    });
  }

  server.register(safePlugin(multipartFile, 'multipartFile'), {
    attachFieldsToBody: true,
    limits: {
      fileSize: withInfrastructure
        ? generalEnvironment.uploadLimitInBytes
        : 10 * 1024 * 1024,
    },
  });

  if (withInfrastructure) {
    server.register(safePlugin(dbConnector, 'database'));
    server.register(safePlugin(redisPlugin, 'redis'));
    server.register(
      safePlugin(planEntitlementTelemetryPlugin, 'planEntitlementTelemetry')
    );
    server.register(safePlugin(s3Plugin, 's3'));
  }

  server.register(safePlugin(authenticateKeyApi, 'authenticateKeyApi'));
  server.register(
    safePlugin(authenticatePublicApiToken, 'authenticatePublicApiToken')
  );
  server.register(safePlugin(i18nextPlugin, 'i18next'));
  if (withInfrastructure) {
    server.register(safePlugin(jwtPlugin, 'jwt'));
  }
  server.register(safePlugin(corsPlugin, 'cors'));

  if (withInfrastructure) {
    server.register(safePlugin(databaseElasticPlugin, 'databaseElastic'), {
      prefix: ERouteModule.public,
    });
    server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams'), {
      module: ERouteModule.public,
    });
  }

  server.register(safePlugin(fastifyQs, 'fastifyQs'));
  server.register(safePlugin(swaggerPlugin, 'swagger'));
  server.register(safePlugin(routes, 'routes', true), {
    prefix: `/${EPrefixRoutes.v1}`,
  });

  return server;
}

async function start(): Promise<void> {
  const server = buildPublicServer();

  try {
    await server.listen({ port: 3001, host: '0.0.0.0' });
    server.log.info('Public API running');
  } catch (error) {
    server.log.error(error);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : null;
if (entrypoint === fileURLToPath(import.meta.url)) {
  void start();
}
