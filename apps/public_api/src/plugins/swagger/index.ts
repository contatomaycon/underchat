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
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { getPackageVersion } from '@core/common/functions/getPackageVersion';
import { EDocumentation } from '@core/common/enums/EDocumentation';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { enrichPublicOpenApi } from '@core/common/functions/enrichPublicOpenApi';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findPackageJson(startDirectory: string): string {
  let directory = startDirectory;

  while (true) {
    const candidate = path.join(directory, 'package.json');
    if (existsSync(candidate)) return candidate;

    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error('Public API package.json not found');
    }
    directory = parent;
  }
}

const swaggerPlugin = async (fastify: FastifyInstance) => {
  const patchPackage = findPackageJson(__dirname);

  fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Public Underchat API',
        description:
          'Seja bem-vindo a Underchat! Nesta documentação, apresentaremos uma visão detalhada da API. Através deste guia, você obterá uma compreensão abrangente do desenvolvimento, implementação e manutenção deste projeto.',
        version: getPackageVersion(patchPackage),
      },
      servers: [
        {
          url: `${generalEnvironment.protocol}://${generalEnvironment.appUrlPublic}/${EPrefixRoutes.v1}`,
          description: 'API pública v1',
        },
      ],
      components: {
        securitySchemes: {
          authenticateKeyApi: {
            type: 'apiKey',
            in: 'header',
            name: 'keyapi',
            description:
              'Token da API pública gerado na tela Integrações. Envie o valor sem prefixo.',
          },
        },
      },
      tags: [
        {
          name: 'Health',
          description: 'Disponibilidade e saúde da API',
        },
        {
          name: 'Webhook',
          description: 'Entrada de dados de CRMs, formulários e automações',
        },
        {
          name: 'Chat',
          description: 'Atendimentos, contatos e mensagens',
        },
        {
          name: 'Etiquetas',
          description: 'Modelos de etiquetas da conta',
        },
        {
          name: 'Setores',
          description: 'Setores e seus usuários',
        },
        {
          name: 'Usuários',
          description:
            'Usuários da conta, identidade executora e vínculos operacionais',
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
      content: () => enrichPublicOpenApi(fastify.swagger()),
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
    transformSpecification: (swaggerObject) =>
      enrichPublicOpenApi(swaggerObject),
    transformStaticCSP: (header: string): string => {
      return header;
    },
  });

  fastify.withTypeProvider<TypeBoxTypeProvider>();
};

export default fp(swaggerPlugin, { name: 'swagger' });
