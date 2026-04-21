import 'reflect-metadata';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import { VoiceIaListerRepository } from '@core/repositories/voiceIa/VoiceIaLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('VoiceIaListerRepository', () => {
  it('setFiltersVoiceIa includes account and optional filters', () => {
    const repository = new VoiceIaListerRepository({} as never);

    const result = (repository as any).setFiltersVoiceIa(
      {
        name: 'bot',
        status: EVoiceIaStatus.active,
      },
      'acc-1'
    );

    expect(result).toHaveLength(3);
  });

  it('listVoiceIas returns empty list when query returns null', async () => {
    const db = {
      query: {
        voiceIa: {
          findMany: jest.fn(async () => null),
        },
      },
    };

    const repository = new VoiceIaListerRepository(db as never);

    await expect(repository.listVoiceIas(10, 1, {}, 'acc-1')).resolves.toEqual(
      []
    );
  });

  it('listVoiceIas maps voice type names', async () => {
    const db = {
      query: {
        voiceIa: {
          findMany: jest.fn(async () => [
            {
              voice_ia_id: 'voice-1',
              name: 'Voice 1',
              voice_ia_type: EVoiceIaType.eleven_labs,
              status: EVoiceIaStatus.active,
              created_at: '2026-04-21T10:00:00.000Z',
            },
            {
              voice_ia_id: 'voice-2',
              name: 'Voice 2',
              voice_ia_type: 'custom',
              status: EVoiceIaStatus.inactive,
              created_at: '2026-04-21T10:00:00.000Z',
            },
          ]),
        },
      },
    };

    const repository = new VoiceIaListerRepository(db as never);

    await expect(repository.listVoiceIas(10, 1, {}, 'acc-1')).resolves.toEqual([
      {
        voice_ia_id: 'voice-1',
        name: 'Voice 1',
        voice_ia_type_name: 'ElevenLabs',
        status: EVoiceIaStatus.active,
        created_at: '2026-04-21T10:00:00.000Z',
      },
      {
        voice_ia_id: 'voice-2',
        name: 'Voice 2',
        voice_ia_type_name: 'custom',
        status: EVoiceIaStatus.inactive,
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]);
  });

  it('listVoiceIasTotal returns count and fallback zero', async () => {
    const withCount = createSelectDbMock([{ count: 4 }]);
    const withoutCount = createSelectDbMock([]);

    const withCountRepository = new VoiceIaListerRepository({
      query: {
        voiceIa: {
          findMany: jest.fn(),
        },
      },
      select: withCount.db.select,
    } as never);

    const withoutCountRepository = new VoiceIaListerRepository({
      query: {
        voiceIa: {
          findMany: jest.fn(),
        },
      },
      select: withoutCount.db.select,
    } as never);

    await expect(
      withCountRepository.listVoiceIasTotal({}, 'acc-1')
    ).resolves.toBe(4);
    await expect(
      withoutCountRepository.listVoiceIasTotal({}, 'acc-1')
    ).resolves.toBe(0);
  });
});
