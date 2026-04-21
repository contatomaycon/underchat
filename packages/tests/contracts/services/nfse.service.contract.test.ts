import 'reflect-metadata';

jest.mock('@core/repositories/config/NfseViewer.repository', () => ({
  NfseViewerRepository: class {},
}));

jest.mock('@core/repositories/config/NfseUpdater.repository', () => ({
  NfseUpdaterRepository: class {},
}));

jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class {},
}));

jest.mock('@core/services/nfseCertificateStorage.service', () => ({
  NfseCertificateStorageService: class {},
}));

import { NfseService } from '@core/services/nfse.service';

describe('NfseService', () => {
  const t = ((key: string) => `translated:${key}`) as never;

  const makeService = () => {
    const nfseViewerRepository = {
      viewNfse: jest.fn(async () => ({ nfse_id: 'nfse-1' })),
    };

    const nfseUpdaterRepository = {
      upsertNfse: jest.fn(async () => ({ success: true })),
      viewDefaultNfseIntegrationMetadata: jest.fn<Promise<any | null>, any[]>(
        async () => ({
          nfse_id: 'nfse-1',
          integration_password_encrypted: 'enc:old',
        })
      ),
      updateNfseIntegration: jest.fn(async () => ({ updated: true })),
      viewDefaultNfseCertificateMetadata: jest.fn<Promise<any | null>, any[]>(
        async () => ({
          nfse_id: 'nfse-1',
          certificate_bucket: 'old-bucket',
          certificate_key: 'old-key',
        })
      ),
      updateNfseCertificate: jest.fn(async () => ({ updated: true })),
    };

    const passwordEncryptorService = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
    };

    const nfseCertificateStorageService = {
      uploadCertificate: jest.fn(async () => ({
        bucket: 'new-bucket',
        key: 'new-key',
        fileName: 'cert.p12',
        uploadedAt: '2026-04-21T12:00:00.000Z',
      })),
      deleteCertificate: jest.fn(async () => undefined),
    };

    const service = new NfseService(
      nfseViewerRepository as never,
      nfseUpdaterRepository as never,
      passwordEncryptorService as never,
      nfseCertificateStorageService as never
    );

    return {
      service,
      nfseViewerRepository,
      nfseUpdaterRepository,
      passwordEncryptorService,
      nfseCertificateStorageService,
    };
  };

  const validIntegrationInput = {
    integration_enabled: true,
    integration_base_url: 'https://api.example.com',
    integration_uf: 'sp',
    integration_tenant: 'tenant-a',
    integration_username: 'user-a',
    integration_municipality_code: '1234567',
    integration_rps_series: 'A1',
    integration_prestador_document: '12.345.678/0001-90',
    integration_prestador_municipal_inscription: 'IM123',
    integration_password: 'new-pass',
  };

  it('delegates viewNfse and upsertNfse', async () => {
    const { service, nfseViewerRepository, nfseUpdaterRepository } =
      makeService();

    await expect(service.viewNfse()).resolves.toEqual({ nfse_id: 'nfse-1' });
    expect(nfseViewerRepository.viewNfse).toHaveBeenCalledTimes(1);

    await expect(
      service.upsertNfse(t, { any: 'value' } as never)
    ).resolves.toEqual({
      success: true,
    });
    expect(nfseUpdaterRepository.upsertNfse).toHaveBeenCalledWith(t, {
      any: 'value',
    });
  });

  it('upsertNfseIntegration validates required fields and invalid values', async () => {
    const { service, nfseUpdaterRepository } = makeService();

    nfseUpdaterRepository.viewDefaultNfseIntegrationMetadata.mockResolvedValueOnce(
      null
    );
    await expect(service.upsertNfseIntegration(t, {} as never)).rejects.toThrow(
      'translated:nfse_not_found'
    );

    const invalidCases: Array<{
      input: Record<string, unknown>;
      expected: string;
    }> = [
      {
        input: { ...validIntegrationInput, integration_base_url: ' ' },
        expected: 'translated:nfse_integration_base_url_required',
      },
      {
        input: { ...validIntegrationInput, integration_base_url: 'not-an-url' },
        expected: 'translated:nfse_integration_base_url_invalid',
      },
      {
        input: { ...validIntegrationInput, integration_uf: ' ' },
        expected: 'translated:nfse_integration_uf_required',
      },
      {
        input: { ...validIntegrationInput, integration_uf: 'BRA' },
        expected: 'translated:nfse_integration_uf_invalid',
      },
      {
        input: { ...validIntegrationInput, integration_tenant: ' ' },
        expected: 'translated:nfse_integration_tenant_required',
      },
      {
        input: { ...validIntegrationInput, integration_username: ' ' },
        expected: 'translated:nfse_integration_username_required',
      },
      {
        input: { ...validIntegrationInput, integration_municipality_code: ' ' },
        expected: 'translated:nfse_integration_municipality_code_required',
      },
      {
        input: {
          ...validIntegrationInput,
          integration_municipality_code: '123',
        },
        expected: 'translated:nfse_integration_municipality_code_invalid',
      },
      {
        input: { ...validIntegrationInput, integration_rps_series: ' ' },
        expected: 'translated:nfse_integration_rps_series_required',
      },
      {
        input: { ...validIntegrationInput, integration_rps_series: '123456' },
        expected: 'translated:nfse_integration_rps_series_invalid',
      },
      {
        input: {
          ...validIntegrationInput,
          integration_prestador_document: ' ',
        },
        expected: 'translated:nfse_integration_prestador_document_required',
      },
      {
        input: {
          ...validIntegrationInput,
          integration_prestador_document: '1234',
        },
        expected: 'translated:nfse_integration_prestador_document_invalid',
      },
      {
        input: {
          ...validIntegrationInput,
          integration_prestador_municipal_inscription: ' ',
        },
        expected:
          'translated:nfse_integration_prestador_municipal_inscription_required',
      },
    ];

    for (const invalidCase of invalidCases) {
      await expect(
        service.upsertNfseIntegration(t, invalidCase.input as never)
      ).rejects.toThrow(invalidCase.expected);
    }
  });

  it('upsertNfseIntegration supports disable flow and password requirement rules', async () => {
    const { service, nfseUpdaterRepository, passwordEncryptorService } =
      makeService();

    await expect(
      service.upsertNfseIntegration(t, {
        integration_enabled: false,
      } as never)
    ).resolves.toEqual({ updated: true });

    expect(nfseUpdaterRepository.updateNfseIntegration).toHaveBeenCalledWith(
      'nfse-1',
      {
        integration_enabled: false,
      }
    );

    nfseUpdaterRepository.viewDefaultNfseIntegrationMetadata.mockResolvedValueOnce(
      {
        nfse_id: 'nfse-1',
        integration_password_encrypted: null,
      }
    );

    await expect(
      service.upsertNfseIntegration(t, {
        ...validIntegrationInput,
        integration_password: ' ',
      } as never)
    ).rejects.toThrow('translated:nfse_integration_password_required');

    await expect(
      service.upsertNfseIntegration(t, {
        ...validIntegrationInput,
        integration_password: 'new-pass',
      } as never)
    ).resolves.toEqual({ updated: true });

    expect(passwordEncryptorService.encrypt).toHaveBeenCalledWith('new-pass');
    expect(
      nfseUpdaterRepository.updateNfseIntegration
    ).toHaveBeenLastCalledWith(
      'nfse-1',
      expect.objectContaining({
        integration_enabled: true,
        integration_uf: 'SP',
        integration_password_encrypted: 'enc:new-pass',
        integration_prestador_document: '12345678000190',
      })
    );

    await expect(
      service.upsertNfseIntegration(t, {
        ...validIntegrationInput,
        integration_password: ' ',
      } as never)
    ).resolves.toEqual({ updated: true });

    expect(
      nfseUpdaterRepository.updateNfseIntegration
    ).toHaveBeenLastCalledWith(
      'nfse-1',
      expect.objectContaining({ integration_password_encrypted: undefined })
    );
  });

  it('uploadNfseCertificate validates nfse existence and maps upload errors', async () => {
    const { service, nfseUpdaterRepository, nfseCertificateStorageService } =
      makeService();

    nfseUpdaterRepository.viewDefaultNfseCertificateMetadata.mockResolvedValueOnce(
      null
    );
    await expect(
      service.uploadNfseCertificate(
        t,
        'acc-1',
        { filename: 'cert.p12', toBuffer: jest.fn() } as never,
        'pass'
      )
    ).rejects.toThrow('translated:nfse_not_found');

    nfseCertificateStorageService.uploadCertificate.mockRejectedValueOnce(
      new Error('NFSE_CERTIFICATE_INVALID_FORMAT')
    );
    await expect(
      service.uploadNfseCertificate(
        t,
        'acc-1',
        { filename: 'cert.p12', toBuffer: jest.fn() } as never,
        'pass'
      )
    ).rejects.toThrow('translated:nfse_certificate_invalid_format');

    nfseCertificateStorageService.uploadCertificate.mockRejectedValueOnce(
      new Error('NFSE_CERTIFICATE_SIZE_LIMIT_EXCEEDED')
    );
    await expect(
      service.uploadNfseCertificate(
        t,
        'acc-1',
        { filename: 'cert.p12', toBuffer: jest.fn() } as never,
        'pass'
      )
    ).rejects.toThrow('translated:nfse_certificate_size_exceeded');

    nfseCertificateStorageService.uploadCertificate.mockRejectedValueOnce(
      new Error('other-error')
    );
    await expect(
      service.uploadNfseCertificate(
        t,
        'acc-1',
        { filename: 'cert.p12', toBuffer: jest.fn() } as never,
        'pass'
      )
    ).rejects.toThrow('other-error');
  });

  it('uploadNfseCertificate updates metadata and manages previous/new certificate cleanup', async () => {
    const {
      service,
      nfseUpdaterRepository,
      passwordEncryptorService,
      nfseCertificateStorageService,
    } = makeService();

    await expect(
      service.uploadNfseCertificate(
        t,
        'acc-1',
        {
          filename: 'cert.p12',
          mimetype: 'application/pkcs12',
          toBuffer: jest.fn(async () => Buffer.from('x')),
        } as never,
        'cert-pass'
      )
    ).resolves.toEqual({ updated: true });

    expect(passwordEncryptorService.encrypt).toHaveBeenCalledWith('cert-pass');
    expect(nfseUpdaterRepository.updateNfseCertificate).toHaveBeenCalledWith(
      'nfse-1',
      {
        certificate_bucket: 'new-bucket',
        certificate_key: 'new-key',
        certificate_file_name: 'cert.p12',
        certificate_password_encrypted: 'enc:cert-pass',
        certificate_uploaded_at: '2026-04-21T12:00:00.000Z',
      }
    );

    expect(
      nfseCertificateStorageService.deleteCertificate
    ).toHaveBeenCalledWith('old-bucket', 'old-key');

    nfseUpdaterRepository.updateNfseCertificate.mockRejectedValueOnce(
      new Error('update-failed')
    );

    await expect(
      service.uploadNfseCertificate(
        t,
        'acc-1',
        {
          filename: 'cert.p12',
          mimetype: 'application/pkcs12',
          toBuffer: jest.fn(async () => Buffer.from('x')),
        } as never,
        'cert-pass'
      )
    ).rejects.toThrow('update-failed');

    expect(
      nfseCertificateStorageService.deleteCertificate
    ).toHaveBeenCalledWith('new-bucket', 'new-key');

    nfseUpdaterRepository.viewDefaultNfseCertificateMetadata.mockResolvedValueOnce(
      {
        nfse_id: 'nfse-1',
        certificate_bucket: 'old-bucket',
        certificate_key: 'new-key',
      }
    );

    await expect(
      service.uploadNfseCertificate(
        t,
        'acc-1',
        {
          filename: 'cert.p12',
          mimetype: 'application/pkcs12',
          toBuffer: jest.fn(async () => Buffer.from('x')),
        } as never,
        'cert-pass'
      )
    ).resolves.toEqual({ updated: true });

    const deleteCalls = nfseCertificateStorageService.deleteCertificate.mock
      .calls as unknown as unknown[][];
    expect(
      deleteCalls.some(
        (call) => call[0] === 'old-bucket' && call[1] === 'new-key'
      )
    ).toBe(false);
  });
});
