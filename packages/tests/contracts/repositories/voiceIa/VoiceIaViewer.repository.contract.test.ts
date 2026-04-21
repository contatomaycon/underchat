import 'reflect-metadata';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import { VoiceIaViewerRepository } from '@core/repositories/voiceIa/VoiceIaViewer.repository';

describe('VoiceIaViewerRepository', () => {
  it('returns null when voice IA is not found', async () => {
    const db = {
      query: {
        voiceIa: {
          findFirst: jest.fn(async () => null),
        },
      },
    };

    const repository = new VoiceIaViewerRepository(db as never);

    await expect(
      repository.viewVoiceIa('voice-1', 'acc-1')
    ).resolves.toBeNull();
  });

  it('returns mapped voice IA payload when record exists', async () => {
    const row = {
      voice_ia_id: 'voice-1',
      name: 'Voice 1',
      voice_ia_type: EVoiceIaType.eleven_labs,
      api_key: 'api-key',
      status: EVoiceIaStatus.active,
      voice_id: 'v-1',
      model_id: 'model-1',
      language_code: 'pt-BR',
      speed: '1',
      stability: '0.5',
      similarity_boost: '0.75',
      style_exaggeration: '0',
      created_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T11:00:00.000Z',
    };

    const db = {
      query: {
        voiceIa: {
          findFirst: jest.fn(async () => row),
        },
      },
    };

    const repository = new VoiceIaViewerRepository(db as never);

    await expect(repository.viewVoiceIa('voice-1', 'acc-1')).resolves.toEqual(
      row
    );
  });
});
