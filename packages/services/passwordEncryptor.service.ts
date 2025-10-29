import { injectable } from 'tsyringe';
import { generalEnvironment } from '@core/config/environments';
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from 'crypto';

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
    const [ivHex, authTagHex, encryptedHex] = encryptedText.split(':');
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
