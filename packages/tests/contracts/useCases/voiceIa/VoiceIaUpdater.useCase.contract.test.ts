import 'reflect-metadata';

jest.mock('@core/services/voiceIa.service', () => ({
  VoiceIaService: class {},
}));

import { VoiceIaUpdaterUseCase } from '@core/useCases/voiceIa/VoiceIaUpdater.useCase';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';

describe('VoiceIaUpdaterUseCase', () => {
  const currentVoiceIa = {
    voice_ia_id: 'voice-1',
    voice_ia_type: EVoiceIaType.eleven_labs,
    model_id: 'eleven_multilingual_v2',
  };

  it('throws when voice ia does not exist', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => null),
      updateVoiceIa: jest.fn(),
    };
    const useCase = new VoiceIaUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'voice-1', 'acc-1', {} as never)
    ).rejects.toThrow('voice_ia_not_found');
    expect(service.updateVoiceIa).not.toHaveBeenCalled();
  });

  it('updates when voice ia exists', async () => {
    const input = { name: 'new-name' } as never;
    const service = {
      viewVoiceIa: jest.fn(async () => currentVoiceIa),
      updateVoiceIa: jest.fn(async () => true),
    };
    const useCase = new VoiceIaUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'voice-1', 'acc-1', input)
    ).resolves.toBe(true);
    expect(service.updateVoiceIa).toHaveBeenCalledWith(
      'voice-1',
      'acc-1',
      input
    );
  });

  it.each([
    [EVoiceIaType.eleven_labs, 'eleven_multilingual_v2'],
    [EVoiceIaType.gpt, 'tts-1'],
    [EVoiceIaType.gemini, 'gemini-3.1-flash-tts-preview'],
  ])(
    'uses the %s default when provider changes and model is omitted',
    async (voiceIaType, expectedModel) => {
      const existingProvider =
        voiceIaType === EVoiceIaType.eleven_labs
          ? EVoiceIaType.gpt
          : EVoiceIaType.eleven_labs;
      const service = {
        viewVoiceIa: jest.fn(async () => ({
          ...currentVoiceIa,
          voice_ia_type: existingProvider,
          model_id:
            existingProvider === EVoiceIaType.gpt
              ? 'tts-1'
              : 'eleven_multilingual_v2',
        })),
        updateVoiceIa: jest.fn(async () => true),
      };
      const useCase = new VoiceIaUpdaterUseCase(service as never);

      const input = {
        voice_ia_type: voiceIaType,
        api_key: 'new-provider-key',
        voice_id:
          voiceIaType === EVoiceIaType.gemini
            ? 'Kore'
            : voiceIaType === EVoiceIaType.gpt
              ? 'alloy'
              : 'eleven-voice-id',
      };
      await useCase.execute(jest.fn() as never, 'voice-1', 'acc-1', input);

      expect(service.updateVoiceIa).toHaveBeenCalledWith('voice-1', 'acc-1', {
        ...input,
        model_id: expectedModel,
      });
    }
  );

  it('replaces an incompatible model when provider changes', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => currentVoiceIa),
      updateVoiceIa: jest.fn(async () => true),
    };
    const useCase = new VoiceIaUpdaterUseCase(service as never);

    await useCase.execute(jest.fn() as never, 'voice-1', 'acc-1', {
      voice_ia_type: EVoiceIaType.gemini,
      model_id: 'tts-1',
      api_key: 'new-gemini-key',
      voice_id: 'Kore',
    });

    expect(service.updateVoiceIa).toHaveBeenCalledWith('voice-1', 'acc-1', {
      voice_ia_type: EVoiceIaType.gemini,
      model_id: 'gemini-3.1-flash-tts-preview',
      api_key: 'new-gemini-key',
      voice_id: 'Kore',
    });
  });

  it('rejects a provider change without provider-scoped credentials', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => currentVoiceIa),
      updateVoiceIa: jest.fn(async () => true),
    };
    const useCase = new VoiceIaUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'voice-1', 'acc-1', {
        voice_ia_type: EVoiceIaType.gemini,
      })
    ).resolves.toBe(false);

    expect(service.updateVoiceIa).not.toHaveBeenCalled();
  });

  it('preserves a compatible model and normalizes Gemini models/ prefixes', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => currentVoiceIa),
      updateVoiceIa: jest.fn(async () => true),
    };
    const useCase = new VoiceIaUpdaterUseCase(service as never);

    await useCase.execute(jest.fn() as never, 'voice-1', 'acc-1', {
      voice_ia_type: EVoiceIaType.gemini,
      model_id: ' models/models/gemini-2.5-flash-preview-tts ',
      api_key: 'new-gemini-key',
      voice_id: 'Kore',
    });

    expect(service.updateVoiceIa).toHaveBeenCalledWith('voice-1', 'acc-1', {
      voice_ia_type: EVoiceIaType.gemini,
      model_id: 'gemini-2.5-flash-preview-tts',
      api_key: 'new-gemini-key',
      voice_id: 'Kore',
    });
  });

  it('repairs a prefixed Gemini model during an unrelated update', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => ({
        ...currentVoiceIa,
        voice_ia_type: EVoiceIaType.gemini,
        model_id: ' models/gemini-3.1-flash-tts-preview ',
      })),
      updateVoiceIa: jest.fn(async () => true),
    };
    const useCase = new VoiceIaUpdaterUseCase(service as never);

    await useCase.execute(jest.fn() as never, 'voice-1', 'acc-1', {
      name: 'Gemini Voice',
    });

    expect(service.updateVoiceIa).toHaveBeenCalledWith('voice-1', 'acc-1', {
      name: 'Gemini Voice',
      model_id: 'gemini-3.1-flash-tts-preview',
    });
  });

  it('repairs a legacy cross-provider model during an unrelated update', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => ({
        ...currentVoiceIa,
        voice_ia_type: EVoiceIaType.gpt,
        model_id: 'eleven_multilingual_v2',
      })),
      updateVoiceIa: jest.fn(async () => true),
    };
    const useCase = new VoiceIaUpdaterUseCase(service as never);

    await useCase.execute(jest.fn() as never, 'voice-1', 'acc-1', {
      name: 'GPT Voice',
    });

    expect(service.updateVoiceIa).toHaveBeenCalledWith('voice-1', 'acc-1', {
      name: 'GPT Voice',
      model_id: 'tts-1',
    });
  });

  it('does not replace an existing custom model during an unrelated update', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => ({
        ...currentVoiceIa,
        model_id: 'custom-eleven-compatible-model',
      })),
      updateVoiceIa: jest.fn(async () => true),
    };
    const useCase = new VoiceIaUpdaterUseCase(service as never);
    const input = { name: 'Custom Voice' };

    await useCase.execute(jest.fn() as never, 'voice-1', 'acc-1', input);

    expect(service.updateVoiceIa).toHaveBeenCalledWith(
      'voice-1',
      'acc-1',
      input
    );
  });
});
