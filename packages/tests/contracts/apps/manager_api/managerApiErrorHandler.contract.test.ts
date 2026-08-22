import 'reflect-metadata';
import { afterEach, describe, expect, it } from '@jest/globals';
import fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { managerApiErrorHandler } from '@core/common/functions/managerApiErrorHandler';
import { WorkerCommandOperationalBarrierError } from '@core/services/workerCommandOperationalBarrier.service';

const errorResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: false }),
  message: Type.String(),
  data: Type.Null(),
});

function buildServer(): FastifyInstance {
  const server = fastify({ logger: false });
  server.setErrorHandler(managerApiErrorHandler);

  server.post('/body', {
    schema: {
      body: Type.Object({
        status: Type.Literal('in_chat'),
      }),
      response: { 400: errorResponseSchema },
    },
    handler: async () => ({ status: true }),
  });

  server.get('/params/:id', {
    schema: {
      params: Type.Object({
        id: Type.String({ format: 'uuid' }),
      }),
      response: { 400: errorResponseSchema },
    },
    handler: async () => ({ status: true }),
  });

  server.get('/internal', {
    schema: {
      response: { 500: errorResponseSchema },
    },
    handler: async () => {
      throw new Error('sensitive-internal-detail');
    },
  });

  server.get('/barrier-paused', {
    handler: async () => {
      const error = new WorkerCommandOperationalBarrierError(
        'paused',
        'worker_command_operational_barrier_paused',
        {
          schema_version: 1,
          state: 'paused',
          generation: 4,
          changed_at: '2026-08-13T10:00:00.000Z',
          changed_by: 'change-123',
          reason: 'cutover',
          active_permits: 0,
          oldest_permit_expires_at: null,
        }
      );
      error.operationId = 'operation-paused';
      throw error;
    },
  });

  server.post('/limited', {
    bodyLimit: 4,
    handler: async () => ({ status: true }),
  });

  server.get('/typed-client-error/:status', {
    handler: async (request) => {
      const statusCode = Number((request.params as { status: string }).status);
      throw Object.assign(new Error(`client-error-${statusCode}`), {
        code: `CLIENT_${statusCode}`,
        statusCode,
      });
    },
  });

  return server;
}

describe('manager_api native error handler contract', () => {
  let server: FastifyInstance | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('returns the Underchat envelope and HTTP 400 for malformed JSON', async () => {
    server = buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/body',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      status: false,
      data: null,
    });
  });

  it('returns HTTP 400 for an invalid body contract', async () => {
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

  it('returns HTTP 400 for invalid route params', async () => {
    server = buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/params/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      status: false,
      data: null,
    });
  });

  it('preserves HTTP 413 for a native body-limit error', async () => {
    server = buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/limited',
      headers: { 'content-type': 'text/plain' },
      payload: 'payload-larger-than-four-bytes',
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      status: false,
      data: null,
    });
  });

  it('preserves HTTP 415 for unsupported media types', async () => {
    server = buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/body',
      headers: { 'content-type': 'application/x-underchat-unsupported' },
      payload: 'unsupported',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({
      status: false,
      data: null,
    });
  });

  it.each([401, 404])(
    'preserves an explicitly typed HTTP %s client error',
    async (statusCode) => {
      server = buildServer();

      const response = await server.inject({
        method: 'GET',
        url: `/typed-client-error/${statusCode}`,
      });

      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toMatchObject({
        status: false,
        message: `client-error-${statusCode}`,
        data: null,
      });
    }
  );

  it('keeps unexpected internal errors as a generic HTTP 500', async () => {
    server = buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/internal',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      status: false,
      message: 'Internal server error!',
      data: null,
    });
    expect(response.body).not.toContain('sensitive-internal-detail');
  });

  it('maps a paused command barrier to an explicit retryable HTTP 503', async () => {
    server = buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/barrier-paused',
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.headers['x-operation-id']).toBe('operation-paused');
    expect(response.json()).toMatchObject({
      status: false,
      message: 'worker_command_operational_barrier_paused',
      data: {
        retryable: true,
        acceptance: 'rejected',
        operation_id: 'operation-paused',
        barrier_generation: 4,
      },
    });
  });
});
