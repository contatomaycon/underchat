import { injectable } from 'tsyringe';
import { createHash } from 'node:crypto';
import CryptoJS from 'crypto-js';
import { generalEnvironment } from '@core/config/environments';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { sanitizationMap } from '@core/common/functions/sanitizeValue';

@injectable()
export class EncryptService {
  constructor() {}

  private uniqueHash = (text: string): string => {
    const saltStart = generalEnvironment.cryptoKeyStart;
    const saltEnd = generalEnvironment.cryptoKeyEnd;
    const saltedText = saltStart + text + saltEnd;

    const hash = createHash('sha256');
    hash.update(saltedText);
    return hash.digest('hex');
  };

  encrypt = (value: string | number): string => {
    const valueString = value.toString();

    const saltedText =
      generalEnvironment.cryptoKeyStart +
      valueString +
      generalEnvironment.cryptoKeyEnd;
    const hash = CryptoJS.SHA3(saltedText, { outputLength: 256 }).toString(
      CryptoJS.enc.Hex
    );

    return hash;
  };

  hash = (value: string | number): string => {
    const valueString = value.toString();
    return this.uniqueHash(valueString);
  };

  sanitize = (value: string | number, type: ETypeSanetize): string => {
    const valueString = value.toString();

    return sanitizationMap[type]
      ? sanitizationMap[type](valueString)
      : valueString;
  };
}
