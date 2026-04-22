import 'reflect-metadata';

jest.mock('@core/services/voiceIa.service', () => ({
  VoiceIaService: class {},
}));

import { VoiceIaCreatorUseCase } from '@core/useCases/voiceIa/VoiceIaCreator.useCase';

describe('VoiceIaCreatorUseCase', () => {
  it('delegates creation to voiceIa service', async () => {
    const input = { name: 'ivr' } as never;
    const service = {
      createVoiceIa: jest.fn(async () => 'voice-1'),
    };

    const useCase = new VoiceIaCreatorUseCase(service as never);

    await expect(useCase.execute(input, 'acc-1')).resolves.toBe('voice-1');
    expect(service.createVoiceIa).toHaveBeenCalledWith(input, 'acc-1');
  });

  it('returns null when service returns null', async () => {
    const service = {
      createVoiceIa: jest.fn(async () => null),
    };

    const useCase = new VoiceIaCreatorUseCase(service as never);

    await expect(useCase.execute({} as never, 'acc-1')).resolves.toBeNull();
  });
});
