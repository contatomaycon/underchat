import 'reflect-metadata';
import { VoiceIaDeleterRepository } from '@core/repositories/voiceIa/VoiceIaDeleter.repository';
import { createDeleteDbMock } from '@core/tests/helpers/drizzleMock';

describe('VoiceIaDeleterRepository', () => {
  it('returns true when delete affects rows', async () => {
    const { db } = createDeleteDbMock({ rowCount: 1 });
    const repository = new VoiceIaDeleterRepository(db as never);

    await expect(repository.deleteVoiceIa('voice-1', 'acc-1')).resolves.toBe(
      true
    );
  });

  it('returns false when delete affects no rows', async () => {
    const { db } = createDeleteDbMock({ rowCount: 0 });
    const repository = new VoiceIaDeleterRepository(db as never);

    await expect(repository.deleteVoiceIa('voice-1', 'acc-1')).resolves.toBe(
      false
    );
  });
});
