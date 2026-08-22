import 'reflect-metadata';
import { afterEach, describe, expect, it } from '@jest/globals';
import fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { publicApiErrorHandler } from '@core/common/functions/publicApiErrorHandler';

const errorResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: false }),
  message: Type.String(),
  data: Type.Null(),
});

function buildServer(): FastifyInstance {
  const server = fastify({ logger: false });
  server.setErrorHandler(publicApiErrorHandler);

  server.get('/internal', {
    schema: { response: { 500: errorResponseSchema } },
    handler: async () => {
      throw new Error('sensitive-database-detail');
    },
  });

  server.post('/body', {
    schema: {
      body: Type.Object({ status: Type.Literal('in_chat') }),
      response: { 400: errorResponseSchema },
    },
    handler: async () => ({ status: true }),
  });

  return server;
}

describe('public_api error handler contract', () => {
  let server: FastifyInstance | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('keeps infrastructure failures serializable and hides internal details', async () => {
    server = buildServer();

    const response = await server.inject({ method: 'GET', url: '/internal' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      status: false,
      message: 'Internal server error!',
      data: null,
    });
    expect(response.body).not.toContain('sensitive-database-detail');
  });

  it('keeps request validation failures in the public response envelope', async () => {
    server = buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/body',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      status: false,
      data: null,
    });
  });
});
