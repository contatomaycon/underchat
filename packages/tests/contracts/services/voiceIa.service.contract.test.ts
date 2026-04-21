import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { VoiceIaService } from '@core/services/voiceIa.service';

describe('VoiceIaService', () => {
  it('delegates list and CRUD methods', async () => {
    const listVoiceIas = jest.fn(async () => [{ voice_ia_id: 'v1' }]);
    const listVoiceIasTotal = jest.fn(async () => 6);

    const service = new VoiceIaService(
      { listVoiceIas, listVoiceIasTotal } as never,
      { createVoiceIa: jest.fn(async () => 'v1') } as never,
      { viewVoiceIa: jest.fn(async () => ({ voice_ia_id: 'v1' })) } as never,
      { updateVoiceIa: jest.fn(async () => true) } as never,
      { deleteVoiceIa: jest.fn(async () => true) } as never
    );

    await expect(
      service.listVoiceIas(10, 1, {} as never, 'a1')
    ).resolves.toEqual([[{ voice_ia_id: 'v1' }], 6]);
    await expect(service.createVoiceIa({} as never, 'a1')).resolves.toBe('v1');
    await expect(service.viewVoiceIa('v1', 'a1')).resolves.toEqual({
      voice_ia_id: 'v1',
    });
    await expect(service.updateVoiceIa('v1', 'a1', {} as never)).resolves.toBe(
      true
    );
    await expect(service.deleteVoiceIa('v1', 'a1')).resolves.toBe(true);
  });
});
