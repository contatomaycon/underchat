import 'reflect-metadata';

jest.mock('@core/services/voiceIa.service', () => ({
  VoiceIaService: class {},
}));

import { VoiceIaListerUseCase } from '@core/useCases/voiceIa/VoiceIaLister.useCase';

describe('VoiceIaListerUseCase', () => {
  it('uses query pagination and returns results with pagings', async () => {
    const query = { per_page: 5, current_page: 2 } as never;
    const results = [{ voice_ia_id: 'voice-1' }];
    const service = {
      listVoiceIas: jest.fn(async () => [results, 6]),
    };

    const useCase = new VoiceIaListerUseCase(service as never);

    await expect(useCase.execute(query, 'acc-1')).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 2,
        per_page: 5,
        count: 1,
        total: 6,
      },
      results,
    });

    expect(service.listVoiceIas).toHaveBeenCalledWith(5, 2, query, 'acc-1');
  });

  it('uses default pagination when query fields are missing', async () => {
    const service = {
      listVoiceIas: jest.fn(async () => [[], 0]),
    };

    const useCase = new VoiceIaListerUseCase(service as never);

    await expect(useCase.execute({} as never, 'acc-1')).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });

    expect(service.listVoiceIas).toHaveBeenCalledWith(10, 1, {}, 'acc-1');
  });
});
