import fp from 'fastify-plugin';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyPluginOptions,
} from 'fastify';
import { IAsyncOrCb } from '../interfaces/IAsyncOrCb';

function createPluginError(err: unknown): Error {
  if (err instanceof Error) return err;

  const message = typeof err === 'string' ? err : 'Plugin error';

  return new Error(message);
}

function logPluginError<Options extends FastifyPluginOptions>(
  fastify: FastifyInstance,
  pluginName: string,
  opts: Options,
  error: Error
): void {
  const hasLogger = typeof fastify.log?.error === 'function';

  if (hasLogger) {
    fastify.log.error(
      {
        plugin: pluginName,
        opts,
        message: error.message,
        stack: error.stack,
      },
      `Erro ao registrar plugin "${pluginName}"`
    );

    return;
  }

  console.error(`Erro ao registrar plugin "${pluginName}": ${error.message}`);

  if (error.stack) {
    console.error(error.stack);
  }
}

function runCallbackPlugin<Options extends FastifyPluginOptions>(
  plugin: FastifyPluginCallback<Options>,
  fastify: FastifyInstance,
  opts: Options,
  onError: (err: unknown) => void,
  onSuccess: () => void
): void {
  plugin(fastify, opts, (err?: Error) => {
    if (err) {
      onError(err);
      return;
    }
    onSuccess();
  });
}

function runAsyncPlugin<Options extends FastifyPluginOptions>(
  plugin: FastifyPluginAsync<Options>,
  fastify: FastifyInstance,
  opts: Options,
  onError: (err: unknown) => void,
  onSuccess: () => void
): void {
  Promise.resolve(plugin(fastify, opts)).then(onSuccess, onError);
}

export function safePlugin<
  Options extends FastifyPluginOptions = Record<string, unknown>,
>(plugin: IAsyncOrCb<Options>, name?: string, encapsulate = true) {
  const finalName = name ?? plugin.name ?? 'anonymous-plugin';

  const wrapped: FastifyPluginAsync<Options> = async (
    fastify: FastifyInstance,
    opts: Options
  ) =>
    new Promise<void>((resolve, reject) => {
      const onError = (err: unknown) => {
        const error = createPluginError(err);
        logPluginError(fastify, finalName, opts, error);
        reject(error);
      };

      const onSuccess = () => {
        resolve();
      };

      const isCallbackPlugin = plugin.length >= 3;

      if (isCallbackPlugin) {
        runCallbackPlugin(
          plugin as FastifyPluginCallback<Options>,
          fastify,
          opts,
          onError,
          onSuccess
        );

        return;
      }

      runAsyncPlugin(
        plugin as FastifyPluginAsync<Options>,
        fastify,
        opts,
        onError,
        onSuccess
      );
    });

  return fp(wrapped, {
    name: finalName,
    encapsulate,
  });
}
