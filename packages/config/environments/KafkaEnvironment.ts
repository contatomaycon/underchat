import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { resolveScopedEnvValue } from './envScope';

export class KafkaEnvironment {
  public get kafkaBroker(): string {
    const broker = resolveScopedEnvValue({
      publicKey: 'KAFKA_PUBLIC_BROKER',
      privateKey: 'KAFKA_PRIVATE_BROKER',
      legacyKey: 'KAFKA_BROKER',
    });
    if (!broker) {
      throw new InvalidConfigurationError('KAFKA_BROKER is not defined.');
    }

    return broker;
  }

  public get securityProtocol(): string {
    const securityProtocol = resolveScopedEnvValue({
      publicKey: 'KAFKA_PUBLIC_SECURITY_PROTOCOL',
      privateKey: 'KAFKA_PRIVATE_SECURITY_PROTOCOL',
      legacyKey: 'SECURITY_PROTOCOL',
    });
    if (!securityProtocol) {
      throw new InvalidConfigurationError('SECURITY_PROTOCOL is not defined.');
    }

    return securityProtocol.toLowerCase();
  }

  public get kafkaUsername(): string | undefined {
    const protocol = this.securityProtocol;
    if (protocol === 'plaintext') {
      return undefined;
    }

    const username = resolveScopedEnvValue({
      publicKey: 'KAFKA_PUBLIC_USERNAME',
      privateKey: 'KAFKA_PRIVATE_USERNAME',
      legacyKey: 'KAFKA_USERNAME',
    });
    if (!username) {
      throw new InvalidConfigurationError('KAFKA_USERNAME is not defined.');
    }

    return username;
  }

  public get kafkaPassword(): string | undefined {
    const protocol = this.securityProtocol;
    if (protocol === 'plaintext') {
      return undefined;
    }

    const password = resolveScopedEnvValue({
      publicKey: 'KAFKA_PUBLIC_PASSWORD',
      privateKey: 'KAFKA_PRIVATE_PASSWORD',
      legacyKey: 'KAFKA_PASSWORD',
    });
    if (!password) {
      throw new InvalidConfigurationError('KAFKA_PASSWORD is not defined.');
    }

    return password;
  }

  public get saslMechanism(): string | undefined {
    const protocol = this.securityProtocol;
    if (protocol === 'plaintext') {
      return undefined;
    }

    const saslMechanism = resolveScopedEnvValue({
      publicKey: 'KAFKA_PUBLIC_SASL_MECHANISM',
      privateKey: 'KAFKA_PRIVATE_SASL_MECHANISM',
      legacyKey: 'SASL_MECHANISM',
    });
    if (!saslMechanism) {
      throw new InvalidConfigurationError('SASL_MECHANISM is not defined.');
    }

    return saslMechanism.toUpperCase();
  }

  /**
   * Tempo máximo de espera para acumular mensagens antes de enviar (linger.ms)
   * Valor baixo = menor latência, ideal para chat real-time
   * Valor 5ms oferece bom equilíbrio entre latência e eficiência
   */
  public get queueBufferingMaxMs(): number {
    return 5;
  }

  /**
   * Número máximo de mensagens por batch
   * Valor moderado para chat real-time
   */
  public get batchNumMessages(): number {
    return 50;
  }

  /**
   * Número máximo de mensagens na fila do producer
   * Otimizado para chat: menor consumo de memória
   */
  public get queueBufferingMaxMessages(): number {
    return 10000;
  }

  /**
   * Tamanho máximo da fila do producer em KB (64MB)
   * Otimizado para chat: menor consumo de memória
   */
  public get queueBufferingMaxKbytes(): number {
    return 65536;
  }
}
