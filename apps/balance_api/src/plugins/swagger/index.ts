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
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const swaggerPlugin = async (fastify: FastifyInstance) => {
  const patchPackage = path.join(__dirname, '../../../package.json');

  fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Balancer UnderChat API',
        description:
          'Seja bem-vindo a UnderChat! Nesta documentação, apresentaremos uma visão detalhada da API. Através deste guia, você obterá uma compreensão abrangente do desenvolvimento, implementação e manutenção deste projeto.',
        version: getPackageVersion(patchPackage),
      },
      servers: [
        {
          url: `${generalEnvironment.protocol}://${generalEnvironment.appUrlBalancer}`,
        },
      ],
      components: {
        securitySchemes: {
          authenticateKeyApi: {
            type: 'apiKey',
            in: 'header',
            name: 'keyapi',
            description: 'Chave API para autenticação',
          },
        },
      },
      tags: [
        {
          name: ETagSwagger.health,
          description: 'End-points relacionados à saúde do sistema',
        },
        {
          name: ETagSwagger.worker,
          description: 'End-points relacionados à canais',
        },
      ],
    },
  });

  const ScalarApiReference = (await import('@scalar/fastify-api-reference'))
    .default;

  fastify.register(ScalarApiReference, {
    routePrefix: EDocumentation.scalar,
    configuration: {
      layout: 'classic',
    },
  });

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

  fastify.withTypeProvider<TypeBoxTypeProvider>();
};

export default fp(swaggerPlugin, { name: 'swagger' });
