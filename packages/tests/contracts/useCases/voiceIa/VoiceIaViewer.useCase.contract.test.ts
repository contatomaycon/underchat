import 'reflect-metadata';

jest.mock('@core/services/voiceIa.service', () => ({
  VoiceIaService: class {},
}));

import { VoiceIaViewerUseCase } from '@core/useCases/voiceIa/VoiceIaViewer.useCase';

describe('VoiceIaViewerUseCase', () => {
  it('delegates view to voiceIa service', async () => {
    const result = { voice_ia_id: 'voice-1' };
    const service = {
      viewVoiceIa: jest.fn(async () => result),
    };

    const useCase = new VoiceIaViewerUseCase(service as never);

    await expect(useCase.execute('voice-1', 'acc-1')).resolves.toEqual(result);
    expect(service.viewVoiceIa).toHaveBeenCalledWith('voice-1', 'acc-1');
  });

  it('returns null when voice ia is not found', async () => {
    const service = {
      viewVoiceIa: jest.fn(async () => null),
    };

    const useCase = new VoiceIaViewerUseCase(service as never);

    await expect(useCase.execute('voice-1', 'acc-1')).resolves.toBeNull();
  });
});
