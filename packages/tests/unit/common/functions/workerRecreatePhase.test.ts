import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  projectWorkerRecreatePhase,
  projectWorkerRecreatePhaseProjection,
} from '@core/common/functions/workerRecreatePhase';

const lifecycleOperationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
const recoveryOperationId = '91d3d1bf-b6f5-48fa-8934-53ed56f50f20';
const workerContainerId = 'a'.repeat(64);
const runtimeContainerId = 'b'.repeat(64);

const activeRecreate = (overrides: Record<string, unknown> = {}) => ({
  workerStatusId: EWorkerStatus.recreating,
  lifecycleOperationId,
  workerContainerId,
  runtimeContainerId,
  runtimeGeneration: 16,
  bootstrapOperationId: lifecycleOperationId,
  bootstrapRuntimeGeneration: 16,
  bootstrapContainerId: runtimeContainerId,
  bootstrapStartedAt: '2026-08-08T02:21:03.735Z',
  ...overrides,
});

describe('projectWorkerRecreatePhase', () => {
  it('advances only for the exact manager-owned runtime bootstrap tuple', () => {
    expect(projectWorkerRecreatePhaseProjection(activeRecreate())).toEqual({
      phase: EWorkerRecreatePhase.connecting,
      observedAt: '2026-08-08T02:21:03.735Z',
      runtimeRetired: false,
    });
  });

  it('advances an exact PostgreSQL recovery UUIDv4 bootstrap tuple', () => {
    expect(
      projectWorkerRecreatePhase(
        activeRecreate({
          lifecycleOperationId: recoveryOperationId,
          bootstrapOperationId: recoveryOperationId,
        })
      )
    ).toBe(EWorkerRecreatePhase.connecting);
  });

  it.each([
    ['missing runtime container', { runtimeContainerId: null }],
    [
      'marker operation mismatch',
      { bootstrapOperationId: '019fdf2c-63af-73e2-8107-3442eeeb8e20' },
    ],
    ['marker generation mismatch', { bootstrapRuntimeGeneration: 15 }],
    ['marker container mismatch', { bootstrapContainerId: 'c'.repeat(64) }],
    ['marker timestamp missing', { bootstrapStartedAt: null }],
    ['marker timestamp invalid', { bootstrapStartedAt: 'not-a-date' }],
    ['runtime generation invalid', { runtimeGeneration: 0 }],
  ])('fails closed as recreating for %s', (_label, overrides) => {
    expect(projectWorkerRecreatePhase(activeRecreate(overrides))).toBe(
      EWorkerRecreatePhase.recreating
    );
  });

  it.each([
    ['missing worker pointer', null],
    ['same full worker pointer', runtimeContainerId],
    ['same short worker pointer', runtimeContainerId.slice(0, 12)],
  ])(
    'uses the exact bootstrap marker even with %s during the ONLINE pointer race',
    (_label, currentWorkerContainerId) => {
      expect(
        projectWorkerRecreatePhase(
          activeRecreate({ workerContainerId: currentWorkerContainerId })
        )
      ).toBe(EWorkerRecreatePhase.connecting);
    }
  );

  it('projects an exact retirement tombstone and lets it win over a retained bootstrap marker', () => {
    expect(
      projectWorkerRecreatePhaseProjection(
        activeRecreate({
          retiredOperationId: lifecycleOperationId,
          retiredRuntimeGeneration: 16,
          retiredContainerId: runtimeContainerId,
          retiredAt: '2026-08-08T02:21:04.000Z',
        })
      )
    ).toEqual({
      phase: EWorkerRecreatePhase.recreating,
      observedAt: '2026-08-08T02:21:04.000Z',
      runtimeRetired: true,
    });
  });

  it('does not assign an app-clock timestamp before an exact database marker exists', () => {
    expect(
      projectWorkerRecreatePhaseProjection(
        activeRecreate({
          bootstrapOperationId: null,
          bootstrapRuntimeGeneration: null,
          bootstrapContainerId: null,
          bootstrapStartedAt: null,
        })
      )
    ).toEqual({
      phase: EWorkerRecreatePhase.recreating,
      runtimeRetired: false,
    });
  });

  it('accepts legacy 12-character immutable Docker identities explicitly', () => {
    expect(
      projectWorkerRecreatePhase(
        activeRecreate({
          workerContainerId: 'aaaaaaaaaaaa',
          runtimeContainerId: 'bbbbbbbbbbbb',
          bootstrapContainerId: 'bbbbbbbbbbbb',
        })
      )
    ).toBe(EWorkerRecreatePhase.connecting);
  });

  it('keeps the phase during the short ONLINE-with-active-operation race', () => {
    expect(
      projectWorkerRecreatePhase(
        activeRecreate({ workerStatusId: EWorkerStatus.online })
      )
    ).toBe(EWorkerRecreatePhase.connecting);
  });

  it('omits the phase outside an active durable recreate', () => {
    expect(
      projectWorkerRecreatePhase(
        activeRecreate({ workerStatusId: EWorkerStatus.disponible })
      )
    ).toBeUndefined();
    expect(
      projectWorkerRecreatePhase(activeRecreate({ lifecycleOperationId: null }))
    ).toBeUndefined();
    expect(
      projectWorkerRecreatePhase(
        activeRecreate({ lifecycleOperationId: 'not-a-uuid' })
      )
    ).toBeUndefined();
  });
});
