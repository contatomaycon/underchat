import { injectable } from 'tsyringe';
import CryptoJS from 'crypto-js';
import { generalEnvironment } from '@core/config/environments';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { sanitizationMap } from '@core/common/functions/sanitizeValue';

@injectable()
export class EncryptService {
  constructor() {}

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

  sanitize = (value: string | number, type: ETypeSanetize): string => {
    const valueString = value.toString();

    return sanitizationMap[type]
      ? sanitizationMap[type](valueString)
      : valueString;
  };
}
