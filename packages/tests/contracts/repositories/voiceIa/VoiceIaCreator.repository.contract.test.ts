import 'reflect-metadata';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import { VoiceIaCreatorRepository } from '@core/repositories/voiceIa/VoiceIaCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('VoiceIaCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('voice-1');
  });

  it('creates voice IA with default values and returns generated id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new VoiceIaCreatorRepository(db as never);

    await expect(
      repository.createVoiceIa(
        {
          name: 'Voice',
          api_key: 'api-key',
          voice_id: 'v-id',
        } as never,
        'acc-1'
      )
    ).resolves.toBe('voice-1');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        voice_ia_id: 'voice-1',
        voice_ia_type: EVoiceIaType.eleven_labs,
        model_id: 'eleven_multilingual_v2',
        speed: '1',
        stability: '0.5',
        similarity_boost: '0.75',
        style_exaggeration: '0',
        status: EVoiceIaStatus.active,
      })
    );
  });

  it.each([
    [EVoiceIaType.gpt, 'tts-1'],
    [EVoiceIaType.gemini, 'gemini-3.1-flash-tts-preview'],
  ])(
    'uses the provider-specific repository fallback for %s',
    async (voiceIaType, expectedModel) => {
      const { db, values } = createInsertDbMock({ rowCount: 1 });
      const repository = new VoiceIaCreatorRepository(db as never);

      await repository.createVoiceIa(
        {
          name: 'Voice',
          api_key: 'api-key',
          voice_id: 'voice',
          voice_ia_type: voiceIaType,
        },
        'acc-1'
      );

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          voice_ia_type: voiceIaType,
          model_id: expectedModel,
        })
      );
    }
  );

  it('does not persist an ElevenLabs model for a Gemini configuration', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new VoiceIaCreatorRepository(db as never);

    await repository.createVoiceIa(
      {
        name: 'Gemini Voice',
        api_key: 'api-key',
        voice_id: 'Kore',
        voice_ia_type: EVoiceIaType.gemini,
        model_id: 'eleven_multilingual_v2',
      },
      'acc-1'
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        voice_ia_type: EVoiceIaType.gemini,
        model_id: 'gemini-3.1-flash-tts-preview',
      })
    );
  });

  it('returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new VoiceIaCreatorRepository(db as never);

    await expect(
      repository.createVoiceIa(
        {
          name: 'Voice',
          api_key: 'api-key',
          voice_id: 'v-id',
          voice_ia_type: EVoiceIaType.gpt,
          status: EVoiceIaStatus.inactive,
        } as never,
        'acc-1'
      )
    ).resolves.toBeNull();
  });
});
