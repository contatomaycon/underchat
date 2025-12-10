import {
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyPluginOptions,
} from 'fastify';

export type IAsyncOrCb<Options extends FastifyPluginOptions> =
  | FastifyPluginAsync<Options>
  | FastifyPluginCallback<Options>
  | ((...args: unknown[]) => unknown);
