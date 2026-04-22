import 'reflect-metadata';

jest.mock('@core/services/voiceIa.service', () => ({
  VoiceIaService: class {},
}));

import { VoiceIaUpdaterUseCase } from '@core/useCases/voiceIa/VoiceIaUpdater.useCase';

describe('VoiceIaUpdaterUseCase', () => {
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
      viewVoiceIa: jest.fn(async () => ({ voice_ia_id: 'voice-1' })),
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
});
