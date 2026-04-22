import 'reflect-metadata';

jest.mock('@core/services/nfse.service', () => ({
  NfseService: class {},
}));

import { NfseCertificateUploaderUseCase } from '@core/useCases/config/NfseCertificateUploader.useCase';

describe('NfseCertificateUploaderUseCase', () => {
  it('throws when certificate file is missing', async () => {
    const nfseService = {
      uploadNfseCertificate: jest.fn(),
    };
    const useCase = new NfseCertificateUploaderUseCase(nfseService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', {
        certificate: null,
      } as never)
    ).rejects.toThrow('nfse_certificate_file_required');
    expect(nfseService.uploadNfseCertificate).not.toHaveBeenCalled();
  });

  it('throws when certificate password is missing', async () => {
    const nfseService = {
      uploadNfseCertificate: jest.fn(),
    };
    const useCase = new NfseCertificateUploaderUseCase(nfseService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', {
        certificate: { filename: 'cert.pfx' },
      } as never)
    ).rejects.toThrow('nfse_certificate_password_required');
  });

  it('throws when certificate password is blank after trim', async () => {
    const nfseService = {
      uploadNfseCertificate: jest.fn(),
    };
    const useCase = new NfseCertificateUploaderUseCase(nfseService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', {
        certificate: { filename: 'cert.pfx' },
        certificate_password: { value: '   ' },
      } as never)
    ).rejects.toThrow('nfse_certificate_password_required');
  });

  it('uploads certificate with normalized and trimmed password', async () => {
    const response = { success: true };
    const certificate = { filename: 'cert.pfx' };
    const nfseService = {
      uploadNfseCertificate: jest.fn(async () => response),
    };
    const useCase = new NfseCertificateUploaderUseCase(nfseService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', {
        certificate,
        certificate_password: { value: '  secret  ' },
      } as never)
    ).resolves.toEqual(response);

    expect(nfseService.uploadNfseCertificate).toHaveBeenCalledWith(
      t,
      'acc-1',
      certificate,
      'secret'
    );
  });
});
