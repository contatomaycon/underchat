import { injectable } from 'tsyringe';
import CryptoJS from 'crypto-js';
import { generalEnvironment } from '@core/config/environments';

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
}
