import 'reflect-metadata';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';

const t = ((key: string) => key) as never;

describe('WhatsappEmbeddedService', () => {
  it('requires app secret when creating config for the first time', async () => {
    const repository = {
      view: jest.fn(async () => null),
      upsert: jest.fn(),
    };
    const encryptor = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace('enc:', '')),
    };
    const service = new WhatsappEmbeddedService(
      repository as never,
      encryptor as never
    );

    await expect(
      service.updateConfig(t, {
        app_id: 'app-1',
        app_secret: '',
        configuration_id: 'cfg-1',
        api_version: 'v24.0',
      })
    ).rejects.toThrow('whatsapp_embedded_app_secret_required');

    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('preserves existing encrypted secret when update secret is empty', async () => {
    const existing = {
      whatsapp_embedded_config_id: 'config-1',
      app_id: 'app-old',
      app_secret_encrypted: 'enc:old-secret',
      configuration_id: 'cfg-old',
      api_version: 'v23.0',
      created_at: '2026-06-29T00:00:00.000Z',
      updated_at: '2026-06-29T00:00:00.000Z',
    };
    const repository = {
      view: jest
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({
          ...existing,
          app_id: 'app-new',
          configuration_id: 'cfg-new',
          api_version: 'v24.0',
        }),
      upsert: jest.fn(async () => existing),
    };
    const encryptor = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace('enc:', '')),
    };
    const service = new WhatsappEmbeddedService(
      repository as never,
      encryptor as never
    );

    await service.updateConfig(t, {
      app_id: 'app-new',
      app_secret: '',
      configuration_id: 'cfg-new',
      api_version: '24.0',
    });

    expect(repository.upsert).toHaveBeenCalledWith({
      app_id: 'app-new',
      app_secret_encrypted: undefined,
      configuration_id: 'cfg-new',
      api_version: 'v24.0',
    });
    expect(encryptor.encrypt).not.toHaveBeenCalled();
  });

  it('encrypts app secret when provided', async () => {
    const existing = {
      whatsapp_embedded_config_id: 'config-1',
      app_id: 'app-old',
      app_secret_encrypted: 'enc:old-secret',
      configuration_id: 'cfg-old',
      api_version: 'v23.0',
      created_at: null,
      updated_at: null,
    };
    const repository = {
      view: jest
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({
          ...existing,
          app_secret_encrypted: 'enc:new-secret',
        }),
      upsert: jest.fn(async () => existing),
    };
    const encryptor = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace('enc:', '')),
    };
    const service = new WhatsappEmbeddedService(
      repository as never,
      encryptor as never
    );

    await service.updateConfig(t, {
      app_id: 'app-1',
      app_secret: 'new-secret',
      configuration_id: 'cfg-1',
      api_version: 'v24.0',
    });

    expect(encryptor.encrypt).toHaveBeenCalledWith('new-secret');
    expect(repository.upsert).toHaveBeenCalledWith({
      app_id: 'app-1',
      app_secret_encrypted: 'enc:new-secret',
      webhook_verify_token_encrypted: undefined,
      configuration_id: 'cfg-1',
      api_version: 'v24.0',
    });
  });

  it('encrypts webhook verify token without changing an existing app secret', async () => {
    const existing = {
      whatsapp_embedded_config_id: 'config-1',
      app_id: 'app-old',
      app_secret_encrypted: 'enc:old-secret',
      webhook_verify_token_encrypted: null,
      configuration_id: 'cfg-old',
      api_version: 'v23.0',
      created_at: null,
      updated_at: null,
    };
    const repository = {
      view: jest
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({
          ...existing,
          webhook_verify_token_encrypted: 'enc:verify-token',
        }),
      upsert: jest.fn(async () => existing),
    };
    const encryptor = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace('enc:', '')),
    };
    const service = new WhatsappEmbeddedService(
      repository as never,
      encryptor as never
    );

    const response = await service.updateConfig(t, {
      app_id: 'app-1',
      app_secret: '',
      webhook_verify_token: 'verify-token',
      configuration_id: 'cfg-1',
      api_version: 'v25.0',
    });

    expect(encryptor.encrypt).toHaveBeenCalledTimes(1);
    expect(encryptor.encrypt).toHaveBeenCalledWith('verify-token');
    expect(repository.upsert).toHaveBeenCalledWith({
      app_id: 'app-1',
      app_secret_encrypted: undefined,
      webhook_verify_token_encrypted: 'enc:verify-token',
      configuration_id: 'cfg-1',
      api_version: 'v25.0',
    });
    expect(response.webhook_verify_token).toBe('verify-token');
    expect(response.has_webhook_verify_token).toBe(true);
    expect(response.is_webhook_configured).toBe(true);
  });

  it('clears webhook verify token when an empty token is submitted', async () => {
    const existing = {
      whatsapp_embedded_config_id: 'config-1',
      app_id: 'app-old',
      app_secret_encrypted: 'enc:old-secret',
      webhook_verify_token_encrypted: 'enc:old-token',
      configuration_id: 'cfg-old',
      api_version: 'v23.0',
      created_at: null,
      updated_at: null,
    };
    const repository = {
      view: jest
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({
          ...existing,
          webhook_verify_token_encrypted: null,
        }),
      upsert: jest.fn(async () => existing),
    };
    const encryptor = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace('enc:', '')),
    };
    const service = new WhatsappEmbeddedService(
      repository as never,
      encryptor as never
    );

    const response = await service.updateConfig(t, {
      app_id: 'app-1',
      app_secret: '',
      webhook_verify_token: '',
      configuration_id: 'cfg-1',
      api_version: 'v25.0',
    });

    expect(encryptor.encrypt).not.toHaveBeenCalled();
    expect(repository.upsert).toHaveBeenCalledWith({
      app_id: 'app-1',
      app_secret_encrypted: undefined,
      webhook_verify_token_encrypted: null,
      configuration_id: 'cfg-1',
      api_version: 'v25.0',
    });
    expect(response.webhook_verify_token).toBeNull();
    expect(response.has_webhook_verify_token).toBe(false);
    expect(response.is_webhook_configured).toBe(false);
  });
});
