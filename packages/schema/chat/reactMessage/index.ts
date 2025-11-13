import { FastifySchema } from 'fastify';
import { reactMessageParamsSchema, reactMessageBodySchema } from './request.schema';

export const reactMessageSchema: FastifySchema = {
  params: reactMessageParamsSchema,
  body: reactMessageBodySchema,
};

