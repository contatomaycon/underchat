import {
  normalizeKafkaSecurityProtocol,
  resolveKafkaSecurityConfig,
} from '@core/common/functions/kafkaSecurityConfig';
import { buildKafkaJsTlsConfig } from '@core/common/functions/kafkaAdminConfig';
import { rdkafka } from '@core/common/vendors/nodeRdkafka';

describe('Kafka security configuration', () => {
  it.each(['plaintext', 'ssl', 'sasl_plaintext', 'sasl_ssl'])(
    'accepts the explicit %s protocol',
    (protocol) => {
      expect(normalizeKafkaSecurityProtocol(protocol.toUpperCase())).toBe(
        protocol
      );
    }
  );

  it('rejects unknown protocols instead of guessing a security mode', () => {
    expect(() => normalizeKafkaSecurityProtocol('TLS')).toThrow(
      'Unsupported Kafka security protocol'
    );
  });

  it('uses system roots and hostname verification for node-rdkafka', () => {
    expect(
      resolveKafkaSecurityConfig({
        protocol: 'ssl',
      })
    ).toEqual({
      'security.protocol': 'ssl',
      'enable.ssl.certificate.verification': true,
      'ssl.endpoint.identification.algorithm': 'https',
      'ssl.ca.location': 'probe',
    });
  });

  it('emits only properties accepted by the bundled node-rdkafka registry', () => {
    const config = {
      'client.id': 'kafka-native-config-contract',
      'metadata.broker.list': '127.0.0.1:1',
      ...resolveKafkaSecurityConfig({
        protocol: 'ssl',
      }),
    };

    expect(config).not.toHaveProperty('ssl.min.version');

    const admin = rdkafka.AdminClient.create(config);
    expect(admin).toBeDefined();
    admin.disconnect();
  });

  it('accepts only complete supported SASL credentials on SASL protocols', () => {
    expect(
      resolveKafkaSecurityConfig({
        protocol: 'sasl_ssl',
        username: 'worker-runtime',
        password: 'secret',
        saslMechanism: 'SCRAM-SHA-512',
      })
    ).toEqual(
      expect.objectContaining({
        'security.protocol': 'sasl_ssl',
        'sasl.username': 'worker-runtime',
        'sasl.password': 'secret',
        'sasl.mechanism': 'SCRAM-SHA-512',
      })
    );

    expect(() =>
      resolveKafkaSecurityConfig({
        protocol: 'sasl_ssl',
        username: 'worker-runtime',
        saslMechanism: 'PLAIN',
      })
    ).toThrow(
      'Kafka SASL requires a supported mechanism and complete credentials'
    );
    expect(() =>
      resolveKafkaSecurityConfig({
        protocol: 'sasl_ssl',
        username: 'worker-runtime',
        password: 'secret',
        saslMechanism: 'OAUTHBEARER',
      })
    ).toThrow(
      'Kafka SASL requires a supported mechanism and complete credentials'
    );
  });

  it('rejects SASL values on non-SASL protocols', () => {
    expect(() =>
      resolveKafkaSecurityConfig({
        protocol: 'ssl',
        username: 'unexpected-user',
      })
    ).toThrow('Kafka protocol ssl must not include SASL credentials');
  });

  it.each([undefined, 'probe'])(
    'uses system roots for KafkaJS when CA location is %s',
    (caLocation) => {
      const loadCa = jest.fn(() => 'must-not-be-read');

      expect(buildKafkaJsTlsConfig(caLocation, loadCa)).toEqual({
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      });
      expect(loadCa).not.toHaveBeenCalled();
    }
  );

  it('loads an explicit custom CA for KafkaJS', () => {
    const loadCa = jest.fn(() => '-----BEGIN CERTIFICATE-----\nCA\n');

    expect(buildKafkaJsTlsConfig('/etc/kafka/ca.pem', loadCa)).toEqual({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ca: ['-----BEGIN CERTIFICATE-----\nCA\n'],
    });
    expect(loadCa).toHaveBeenCalledWith('/etc/kafka/ca.pem');
  });

  it('fails closed when an explicit KafkaJS CA cannot be loaded or is empty', () => {
    expect(() =>
      buildKafkaJsTlsConfig('/etc/kafka/missing.pem', () => {
        throw new Error('ENOENT');
      })
    ).toThrow('Kafka CA file could not be loaded: ENOENT');
    expect(() =>
      buildKafkaJsTlsConfig('/etc/kafka/empty.pem', () => ' \n')
    ).toThrow('Kafka CA file is empty');
  });
});
