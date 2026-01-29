import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';
import fp from 'fastify-plugin';
import { generalEnvironment } from '@core/config/environments';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { getPackageVersion } from '@core/common/functions/getPackageVersion';
import { EDocumentation } from '@core/common/enums/EDocumentation';
import path from 'node:path';

const swaggerPlugin = async (fastify: FastifyInstance) => {
  const t0 = Date.now();
  console.log('[worker_baileys:init] swagger: plugin iniciado', { ts: t0 });
  const patchPackage = path.join(__dirname, '../../../package.json');

  const tSwagger = Date.now();
  fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Worker Baileys API',
        description:
          'Seja bem-vindo a Underchat! Nesta documentação, apresentaremos uma visão detalhada da API. Através deste guia, você obterá uma compreensão abrangente do desenvolvimento, implementação e manutenção deste projeto.',
        version: getPackageVersion(patchPackage),
      },
      servers: [
        {
          url: `${generalEnvironment.protocol}://${generalEnvironment.appUrlService}`,
        },
      ],
      tags: [
        {
          name: ETagSwagger.health,
          description: 'End-points relacionados à saúde do sistema',
        },
        {
          name: ETagSwagger.connection,
          description: 'End-points relacionados à conexão do sistema',
        },
      ],
    },
  });
  console.log('[worker_baileys:init] swagger: fastifySwagger registrado', {
    ms: Date.now() - tSwagger,
    ts: Date.now(),
  });

  const tScalar = Date.now();
  const ScalarApiReference = (await import('@scalar/fastify-api-reference'))
    .default;
  console.log('[worker_baileys:init] swagger: ScalarApiReference importado', {
    ms: Date.now() - tScalar,
    ts: Date.now(),
  });

  fastify.register(ScalarApiReference, {
    routePrefix: EDocumentation.scalar,
    configuration: {
      layout: 'classic',
    },
  });
  console.log('[worker_baileys:init] swagger: ScalarApiReference registrado', {
    ts: Date.now(),
  });

  const tSwaggerUi = Date.now();
  fastify.register(fastifySwaggerUi, {
    routePrefix: EDocumentation.swagger,
    uiConfig: {
      docExpansion: 'none',
      deepLinking: false,
    },
    uiHooks: {
      onRequest: function (
        request: FastifyRequest,
        reply: FastifyReply,
        next: HookHandlerDoneFunction
      ) {
        next();
      },
      preHandler: function (
        request: FastifyRequest,
        reply: FastifyReply,
        next: HookHandlerDoneFunction
      ) {
        next();
      },
    },
    staticCSP: false,
    transformStaticCSP: (header: string): string => {
      return header;
    },
  });
  console.log('[worker_baileys:init] swagger: fastifySwaggerUi registrado', {
    ms: Date.now() - tSwaggerUi,
    ts: Date.now(),
  });

  fastify.withTypeProvider<TypeBoxTypeProvider>();
  console.log('[worker_baileys:init] swagger: plugin concluído', {
    msTotal: Date.now() - t0,
    ts: Date.now(),
  });
};

export default fp(swaggerPlugin, { name: 'swagger' });
