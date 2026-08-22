import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  defaultWorkerSessionStorage,
  supportsWhatsappSessionStorage,
} from '@core/common/functions/workerSessionStorage';

describe('workerSessionStorage', () => {
  it.each([EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow])(
    'defaults supported WhatsApp provider %s to PostgreSQL',
    (workerType) => {
      expect(defaultWorkerSessionStorage(workerType)).toBe(
        EWorkerSessionStorage.postgres
      );
      expect(supportsWhatsappSessionStorage(workerType)).toBe(true);
    }
  );

  it.each([EWorkerType.whatsapp, EWorkerType.telegram, EWorkerType.discord])(
    'keeps non-session provider %s on the legacy mode',
    (workerType) => {
      expect(defaultWorkerSessionStorage(workerType)).toBe(
        EWorkerSessionStorage.legacy_volume
      );
      expect(supportsWhatsappSessionStorage(workerType)).toBe(false);
    }
  );
});
