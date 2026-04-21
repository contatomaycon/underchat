import 'reflect-metadata';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';

describe('PasswordEncryptorService', () => {
  it('encrypts and decrypts text', () => {
    const service = new PasswordEncryptorService();

    const encrypted = service.encrypt('my-secret');
    const decrypted = service.decrypt(encrypted);

    expect(encrypted).toContain(':');
    expect(decrypted).toBe('my-secret');
  });

  it('throws for invalid encrypted text input and format', () => {
    const service = new PasswordEncryptorService();

    expect(() => service.decrypt('')).toThrow(
      'Encrypted text must be a non-empty string'
    );
    expect(() => service.decrypt('abc')).toThrow(
      'Invalid encrypted text format. Expected format: iv:authTag:encrypted'
    );
    expect(() => service.decrypt('aa::bb')).toThrow(
      'Missing required parts in encrypted text'
    );
  });
});
