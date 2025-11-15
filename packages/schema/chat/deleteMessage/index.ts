import { FastifySchema } from 'fastify';
import {
  deleteMessageParamsSchema,
  deleteMessageBodySchema,
} from './request.schema';

export const deleteMessageSchema: FastifySchema = {
  params: deleteMessageParamsSchema,
  body: deleteMessageBodySchema,
};
