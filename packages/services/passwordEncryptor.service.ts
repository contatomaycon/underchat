import { injectable } from 'tsyringe';
import { generalEnvironment } from '@core/config/environments';
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from 'node:crypto';

@injectable()
export class PasswordEncryptorService {
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY = scryptSync(
    generalEnvironment.cryptoKeyStart,
    generalEnvironment.cryptoKeyEnd,
    32
  );

  constructor() {}

  encrypt = (plainText: string): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.ALGORITHM, this.KEY, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  };

  decrypt = (encryptedText: string): string => {
    if (!encryptedText || typeof encryptedText !== 'string') {
      throw new Error('Encrypted text must be a non-empty string');
    }

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error(
        'Invalid encrypted text format. Expected format: iv:authTag:encrypted'
      );
    }

    const [ivHex, authTagHex, encryptedHex] = parts;

    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error('Missing required parts in encrypted text');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv(this.ALGORITHM, this.KEY, iv);

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  };
}
