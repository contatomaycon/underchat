import { injectable } from 'tsyringe';
import Redis from 'ioredis';
import { cacheEnvironment } from '@core/config/environments';
import { LoggerService } from './logger.service';

@injectable()
export class RedisConnectionService {
  private static client: Redis | null = null;

  constructor(private readonly logger: LoggerService) {
    if (!RedisConnectionService.client) {
      RedisConnectionService.client = new Redis({
        host: cacheEnvironment.cacheHost,
        port: cacheEnvironment.cachePort,
        password: cacheEnvironment.cachePassword,
        db: 0,
      });

      RedisConnectionService.client.on('connect', () => {
        console.log('Conectado ao Redis com sucesso!');
      });

      RedisConnectionService.client.on('error', (error: Error) => {
        this.logger.error(error);
      });
    }
  }

  getClient = (): Redis => {
    if (!RedisConnectionService.client) {
      this.logger.error('Cliente Redis não inicializado.');

      throw new Error('Cliente Redis não inicializado.');
    }

    return RedisConnectionService.client;
  };

  closeConnection = async (): Promise<void> => {
    if (RedisConnectionService.client) {
      await RedisConnectionService.client.quit();

      RedisConnectionService.client = null;
    }
  };
}
