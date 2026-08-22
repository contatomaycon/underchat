import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { resolveScopedEnvValue } from './envScope';
import { normalizeKafkaSecurityProtocol } from '@core/common/functions/kafkaSecurityConfig';

export class KafkaEnvironment {
  private optionalBoolean(envName: string, defaultValue: boolean): boolean {
    const raw = process.env[envName]?.trim().toLowerCase();
    if (!raw) {
      return defaultValue;
    }

    if (['1', 'true', 'yes', 'on'].includes(raw)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(raw)) {
      return false;
    }

    throw new InvalidConfigurationError(
      `${envName} must be a boolean value (true/false).`
    );
  }

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

    return normalizeKafkaSecurityProtocol(securityProtocol);
  }

  public get kafkaUsername(): string | undefined {
    const username = resolveScopedEnvValue({
      publicKey: 'KAFKA_PUBLIC_USERNAME',
      privateKey: 'KAFKA_PRIVATE_USERNAME',
      legacyKey: 'KAFKA_USERNAME',
    });
    if (
      !username &&
      (this.securityProtocol === 'sasl_plaintext' ||
        this.securityProtocol === 'sasl_ssl')
    ) {
      throw new InvalidConfigurationError('KAFKA_USERNAME is not defined.');
    }

    return username;
  }

  public get kafkaPassword(): string | undefined {
    const password = resolveScopedEnvValue({
      publicKey: 'KAFKA_PUBLIC_PASSWORD',
      privateKey: 'KAFKA_PRIVATE_PASSWORD',
      legacyKey: 'KAFKA_PASSWORD',
    });
    if (
      !password &&
      (this.securityProtocol === 'sasl_plaintext' ||
        this.securityProtocol === 'sasl_ssl')
    ) {
      throw new InvalidConfigurationError('KAFKA_PASSWORD is not defined.');
    }

    return password;
  }

  public get saslMechanism(): string | undefined {
    const saslMechanism = resolveScopedEnvValue({
      publicKey: 'KAFKA_PUBLIC_SASL_MECHANISM',
      privateKey: 'KAFKA_PRIVATE_SASL_MECHANISM',
      legacyKey: 'SASL_MECHANISM',
    });
    if (
      !saslMechanism &&
      (this.securityProtocol === 'sasl_plaintext' ||
        this.securityProtocol === 'sasl_ssl')
    ) {
      throw new InvalidConfigurationError('SASL_MECHANISM is not defined.');
    }

    return saslMechanism?.toUpperCase();
  }

  public get sslCaLocation(): string | undefined {
    return process.env.KAFKA_SSL_CA_LOCATION?.trim() || undefined;
  }

  /**
   * Admin transport is available by default so existing producers, schedulers,
   * and lifecycle finalizers keep working without deployment-only flags.
   * Protected worker topic mutations still require their database, lease, and
   * tombstone authorization fences; these options are only explicit kill
   * switches and dedicated-credential overrides.
   */
  public get provisionerOperationsEnabled(): boolean {
    return this.optionalBoolean('KAFKA_PROVISIONER_OPERATIONS_ENABLED', true);
  }

  public get provisionerAllowRuntimeCredentials(): boolean {
    return this.optionalBoolean(
      'KAFKA_PROVISIONER_ALLOW_RUNTIME_CREDENTIALS',
      true
    );
  }

  public get provisionerUsername(): string | undefined {
    return (
      process.env.KAFKA_PROVISIONER_USERNAME?.trim() ||
      (this.provisionerAllowRuntimeCredentials ? this.kafkaUsername : undefined)
    );
  }

  public get provisionerPassword(): string | undefined {
    return (
      process.env.KAFKA_PROVISIONER_PASSWORD ||
      (this.provisionerAllowRuntimeCredentials ? this.kafkaPassword : undefined)
    );
  }

  public get provisionerSaslMechanism(): string | undefined {
    return (
      process.env.KAFKA_PROVISIONER_SASL_MECHANISM?.trim().toUpperCase() ||
      (this.provisionerAllowRuntimeCredentials ? this.saslMechanism : undefined)
    );
  }

  public get finalizerOperationsEnabled(): boolean {
    return this.optionalBoolean('KAFKA_FINALIZER_OPERATIONS_ENABLED', true);
  }

  public get finalizerAllowRuntimeCredentials(): boolean {
    return this.optionalBoolean(
      'KAFKA_FINALIZER_ALLOW_RUNTIME_CREDENTIALS',
      true
    );
  }

  public get finalizerUsername(): string | undefined {
    return (
      process.env.KAFKA_FINALIZER_USERNAME?.trim() ||
      (this.finalizerAllowRuntimeCredentials ? this.kafkaUsername : undefined)
    );
  }

  public get finalizerPassword(): string | undefined {
    return (
      process.env.KAFKA_FINALIZER_PASSWORD ||
      (this.finalizerAllowRuntimeCredentials ? this.kafkaPassword : undefined)
    );
  }

  public get finalizerSaslMechanism(): string | undefined {
    return (
      process.env.KAFKA_FINALIZER_SASL_MECHANISM?.trim().toUpperCase() ||
      (this.finalizerAllowRuntimeCredentials ? this.saslMechanism : undefined)
    );
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
