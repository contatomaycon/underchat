import 'reflect-metadata';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import { VoiceIaUpdaterRepository } from '@core/repositories/voiceIa/VoiceIaUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

describe('VoiceIaUpdaterRepository', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T18:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('updateInput only keeps provided fields', () => {
    const repository = new VoiceIaUpdaterRepository({} as never);

    const result = (repository as any).updateInput({
      name: 'Updated',
      voice_ia_type: EVoiceIaType.gpt,
      speed: '0.9',
      api_key: undefined,
    });

    expect(result).toEqual({
      name: 'Updated',
      voice_ia_type: EVoiceIaType.gpt,
      speed: '0.9',
    });
  });

  it('returns true when there are no fields to update', async () => {
    const repository = new VoiceIaUpdaterRepository({
      update: jest.fn(),
    } as never);

    await expect(
      repository.updateVoiceIa('voice-1', 'acc-1', {})
    ).resolves.toBe(true);
  });

  it('updates voice IA and returns based on rowCount', async () => {
    const withRows = createUpdateDbMock({ rowCount: 1 });
    const withoutRows = createUpdateDbMock({ rowCount: 0 });

    const withRowsRepository = new VoiceIaUpdaterRepository(
      withRows.db as never
    );
    const withoutRowsRepository = new VoiceIaUpdaterRepository(
      withoutRows.db as never
    );

    await expect(
      withRowsRepository.updateVoiceIa('voice-1', 'acc-1', {
        status: EVoiceIaStatus.inactive,
      })
    ).resolves.toBe(true);

    expect(withRows.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: EVoiceIaStatus.inactive,
        updated_at: '2026-04-21T18:00:00.000Z',
      })
    );

    await expect(
      withoutRowsRepository.updateVoiceIa('voice-1', 'acc-1', {
        status: EVoiceIaStatus.inactive,
      })
    ).resolves.toBe(false);
  });
});
