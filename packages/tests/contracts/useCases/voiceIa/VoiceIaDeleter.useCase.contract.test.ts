import 'reflect-metadata';

jest.mock('@core/services/voiceIa.service', () => ({
  VoiceIaService: class {},
}));

import { VoiceIaDeleterUseCase } from '@core/useCases/voiceIa/VoiceIaDeleter.useCase';

describe('VoiceIaDeleterUseCase', () => {
  it('throws when voice ia does not exist', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => null),
      deleteVoiceIa: jest.fn(),
    };
    const useCase = new VoiceIaDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'voice-1', 'acc-1')
    ).rejects.toThrow('voice_ia_not_found');
    expect(service.deleteVoiceIa).not.toHaveBeenCalled();
  });

  it('deletes when voice ia exists', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => ({ voice_ia_id: 'voice-1' })),
      deleteVoiceIa: jest.fn(async () => true),
    };
    const useCase = new VoiceIaDeleterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'voice-1', 'acc-1')
    ).resolves.toBe(true);
    expect(service.deleteVoiceIa).toHaveBeenCalledWith('voice-1', 'acc-1');
  });
});
