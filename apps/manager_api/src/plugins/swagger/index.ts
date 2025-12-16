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
  const patchPackage = path.join(__dirname, '../../../package.json');

  fastify.register(fastifySwagger, {
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
        {
          name: ETagSwagger.sector,
          description: 'End-points relacionados à setores',
        },
        {
          name: ETagSwagger.user,
          description: 'End-points relacionados à usuários',
        },
        {
          name: ETagSwagger.zipcode,
          description: 'End-points relacionados à CEPs',
        },
        {
          name: ETagSwagger.account,
          description: 'End-points relacionados à contas',
        },
        {
          name: ETagSwagger.plan,
          description: 'End-points relacionados à planos',
        },
        {
          name: ETagSwagger.messageTemplate,
          description: 'End-points relacionados à modelos de mensagem',
        },
        {
          name: ETagSwagger.labelTemplate,
          description: 'End-points relacionados à modelos de etiqueta',
        },
        {
          name: ETagSwagger.contact,
          description: 'End-points relacionados à contatos',
        },
        {
          name: ETagSwagger.contactGroup,
          description: 'End-points relacionados à grupos de contatos',
        },
        {
          name: ETagSwagger.contactGroupAssignment,
          description:
            'End-points relacionados à atribuições de grupos de contatos',
        },
        {
          name: ETagSwagger.chatbot,
          description: 'End-points relacionados à chatbot',
        },
        {
          name: ETagSwagger.reportConversationHistory,
          description: 'End-points relacionados ao histórico de conversas',
        },
        {
          name: ETagSwagger.config,
          description: 'End-points relacionados à configurações',
        },
        {
          name: ETagSwagger.accountSettings,
          description: 'End-points relacionados à configurações da conta',
        },
        {
          name: ETagSwagger.dashboard,
          description: 'End-points relacionados ao dashboard',
        },
        {
          name: ETagSwagger.schedule,
          description: 'End-points relacionados a agendamentos',
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
