import 'reflect-metadata';
import { WorkerConfigFieldsViewerRepository } from '@core/repositories/worker/WorkerConfigFieldsViewer.repository';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';

describe('WorkerConfigFieldsViewerRepository', () => {
  it('returns null when worker has no active configs', async () => {
    const repository = new WorkerConfigFieldsViewerRepository({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => []),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.viewWorkerConfigFieldsByWorkerId('w-1')
    ).resolves.toBe(null);
  });

  it('maps config fields and parses simultaneous attendance', async () => {
    const repository = new WorkerConfigFieldsViewerRepository({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [
              {
                worker_config_type_id: EWorkerConfigType.show_attendee_name,
                value: null,
              },
              {
                worker_config_type_id:
                  EWorkerConfigType.generate_protocol_at_start,
                value: 'start text',
              },
              {
                worker_config_type_id:
                  EWorkerConfigType.simultaneous_attendance,
                value: '3',
              },
            ]),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.viewWorkerConfigFieldsByWorkerId('w-1')
    ).resolves.toEqual(
      expect.objectContaining({
        show_attendee_name: true,
        generate_protocol_at_start: 'start text',
        simultaneous_attendance: 3,
      })
    );
  });

  it('parseNumber returns null for invalid numeric string', () => {
    const repository = new WorkerConfigFieldsViewerRepository({} as never);

    expect((repository as any).parseNumber('invalid')).toBeNull();
  });
});
