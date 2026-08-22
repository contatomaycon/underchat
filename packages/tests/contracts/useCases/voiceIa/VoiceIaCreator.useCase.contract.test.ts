import 'reflect-metadata';

jest.mock('@core/services/voiceIa.service', () => ({
  VoiceIaService: class {},
}));

import { VoiceIaCreatorUseCase } from '@core/useCases/voiceIa/VoiceIaCreator.useCase';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import type { CreateVoiceIaRequest } from '@core/schema/voiceIa/createVoiceIa/request.schema';

describe('VoiceIaCreatorUseCase', () => {
  it('delegates normalized creation to voiceIa service', async () => {
    const input: CreateVoiceIaRequest = {
      name: 'ivr',
      api_key: 'key',
      voice_id: 'voice',
    };
    const service = {
      createVoiceIa: jest.fn(async () => 'voice-1'),
    };

    const useCase = new VoiceIaCreatorUseCase(service as never);

    await expect(useCase.execute(input, 'acc-1')).resolves.toBe('voice-1');
    expect(service.createVoiceIa).toHaveBeenCalledWith(
      {
        ...input,
        voice_ia_type: EVoiceIaType.eleven_labs,
        model_id: 'eleven_multilingual_v2',
      },
      'acc-1'
    );
  });

  it.each([
    [EVoiceIaType.eleven_labs, 'eleven_multilingual_v2'],
    [EVoiceIaType.gpt, 'tts-1'],
    [EVoiceIaType.gemini, 'gemini-3.1-flash-tts-preview'],
  ])(
    'uses the provider default model for %s',
    async (voiceIaType, expectedModel) => {
      const service = {
        createVoiceIa: jest.fn(async () => 'voice-1'),
      };
      const useCase = new VoiceIaCreatorUseCase(service as never);

      await useCase.execute(
        {
          name: 'Voice',
          api_key: 'key',
          voice_id: 'voice',
          voice_ia_type: voiceIaType,
        },
        'acc-1'
      );

      expect(service.createVoiceIa).toHaveBeenCalledWith(
        expect.objectContaining({
          voice_ia_type: voiceIaType,
          model_id: expectedModel,
        }),
        'acc-1'
      );
    }
  );

  it('normalizes a Gemini models/ prefix and surrounding spaces', async () => {
    const service = {
      createVoiceIa: jest.fn(async () => 'voice-1'),
    };
    const useCase = new VoiceIaCreatorUseCase(service as never);

    await useCase.execute(
      {
        name: 'Voice',
        api_key: 'key',
        voice_id: 'Kore',
        voice_ia_type: EVoiceIaType.gemini,
        model_id: '  models/ gemini-3.1-flash-tts-preview  ',
      },
      'acc-1'
    );

    expect(service.createVoiceIa).toHaveBeenCalledWith(
      expect.objectContaining({
        model_id: 'gemini-3.1-flash-tts-preview',
      }),
      'acc-1'
    );
  });

  it('returns null when service returns null', async () => {
    const service = {
      createVoiceIa: jest.fn(async () => null),
    };

    const useCase = new VoiceIaCreatorUseCase(service as never);

    await expect(useCase.execute({} as never, 'acc-1')).resolves.toBeNull();
  });
});
