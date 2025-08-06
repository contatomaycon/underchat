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
import routes from '@/routes';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { getPackageVersion } from '@core/common/functions/getPackageVersion';
import { EDocumentation } from '@core/common/enums/EDocumentation';
import path from 'path';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import qs from 'fastify-qs';

const swaggerPlugin = async (fastify: FastifyInstance) => {
  const patchPackage = path.join(__dirname, '../../../package.json');

  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Manager Underchat API',
        description:
          'Seja bem-vindo a Underchat! Nesta documentação, apresentaremos uma visão detalhada da API. Através deste guia, você obterá uma compreensão abrangente do desenvolvimento, implementação e manutenção deste projeto.',
        version: getPackageVersion(patchPackage),
      },
      servers: [
        {
          url: `${generalEnvironment.protocol}://${generalEnvironment.appUrlManager}`,
        },
      ],
      components: {
        securitySchemes: {
          authenticateJwt: {
            type: 'apiKey',
            in: 'header',
            name: 'Authorization',
            description: 'Token JWT para autenticação',
          },
        },
      },
      tags: [
        {
          name: ETagSwagger.auth,
          description: 'End-points relacionados à autenticação',
        },
        {
          name: ETagSwagger.centrifugo,
          description: 'End-points relacionados à Centrifugo',
        },
        {
          name: ETagSwagger.health,
          description: 'End-points relacionados à saúde do sistema',
        },
        {
          name: ETagSwagger.server,
          description: 'End-points relacionados à servidores',
        },
        {
          name: ETagSwagger.role,
          description: 'End-points relacionados à funções',
        },
        {
          name: ETagSwagger.worker,
          description: 'End-points relacionados à canais',
        },
        {
          name: ETagSwagger.chat,
          description: 'End-points relacionados à chats',
        },
      ],
    },
  });

  const ScalarApiReference = (await import('@scalar/fastify-api-reference'))
    .default;

  await fastify.register(ScalarApiReference, {
    routePrefix: EDocumentation.scalar,
    configuration: {
      layout: 'classic',
    },
  });

  await fastify.register(fastifySwaggerUi, {
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
  fastify.register(routes, { prefix: EPrefixRoutes.v1 });
  fastify.register(qs);
};

export default fp(swaggerPlugin, { name: 'swagger' });
