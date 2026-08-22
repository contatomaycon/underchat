import { EServerStatus } from '@core/common/enums/EServerStatus';

interface InstallConsoleSourceItem {
  command: string | null;
  output: string | null;
  date: string | Date;
  event_id?: string;
  installation_id?: string;
  install_event_type?: 'output' | 'stage' | 'lifecycle';
  install_stage?:
    | 'queued'
    | 'packages'
    | 'docker'
    | 'images'
    | 'worker_baileys'
    | 'worker_wwebjs'
    | 'worker_meow'
    | 'balance'
    | 'health';
  install_stage_status?: 'pending' | 'running' | 'complete' | 'error';
  install_status?: 'queued' | 'running' | 'complete' | 'error' | 'canceled';
}

interface InstallConsoleModelUnderTest {
  entries: Array<{ id: string; message: string }>;
  progress: number;
  stages: Array<{ id: string; status: string }>;
  statusText: string;
}

// This reducer lives inside the Vue application, outside the root composite
// TypeScript project. Runtime loading keeps the Jest regression at the
// repository-standard location without pulling the whole web app into tsc.
const { buildInstallConsoleModel } =
  require('../../../../../apps/web/src/components/server/installConsole') as {
    buildInstallConsoleModel: (
      items: InstallConsoleSourceItem[],
      serverStatus?: EServerStatus | string | null
    ) => InstallConsoleModelUnderTest;
  };

const item = (
  overrides: Partial<InstallConsoleSourceItem> = {}
): InstallConsoleSourceItem => ({
  command: 'Install base packages, Docker, images and Balance API',
  output: 'working',
  date: '2026-08-11T21:00:00.000Z',
  ...overrides,
});

describe('installation console authoritative state', () => {
  it('does not finish from an intermediate HTTP 200 while the server is installing', () => {
    const model = buildInstallConsoleModel(
      [
        item({
          command: 'Check Balance API health',
          output: '200',
        }),
        item({
          output: 'Pulling from under-worker-whatsmeow',
          date: '2026-08-11T21:00:01.000Z',
        }),
      ],
      EServerStatus.installing
    );

    expect(model.statusText).toBe('Em andamento');
    expect(model.progress).toBeLessThan(100);
    expect(model.entries).toHaveLength(2);
    expect(model.entries.at(-1)?.message).toContain('Pulling from');
  });

  it('uses structured stages instead of guessing from technical output', () => {
    const model = buildInstallConsoleModel(
      [
        item({
          event_id: 'stage-packages-running',
          installation_id: 'install-1',
          install_event_type: 'stage',
          install_stage: 'packages',
          install_stage_status: 'running',
        }),
        item({
          event_id: 'misleading-output',
          installation_id: 'install-1',
          install_event_type: 'output',
          install_stage: 'packages',
          output: 'under-balance-api package metadata',
          date: '2026-08-11T21:00:01.000Z',
        }),
        item({
          event_id: 'stage-packages-complete',
          installation_id: 'install-1',
          install_event_type: 'stage',
          install_stage: 'packages',
          install_stage_status: 'complete',
          date: '2026-08-11T21:00:02.000Z',
        }),
        item({
          event_id: 'stage-docker-running',
          installation_id: 'install-1',
          install_event_type: 'stage',
          install_stage: 'docker',
          install_stage_status: 'running',
          date: '2026-08-11T21:00:03.000Z',
        }),
      ],
      EServerStatus.installing
    );

    expect(model.stages.find((stage) => stage.id === 'packages')?.status).toBe(
      'complete'
    );
    expect(model.stages.find((stage) => stage.id === 'docker')?.status).toBe(
      'running'
    );
    expect(model.stages.find((stage) => stage.id === 'balance')?.status).toBe(
      'pending'
    );
  });

  it('only reaches 100 after the authoritative server state is online', () => {
    const events = [
      item({
        event_id: 'health-complete',
        installation_id: 'install-1',
        install_event_type: 'stage',
        install_stage: 'health',
        install_stage_status: 'complete',
      }),
    ];

    const installing = buildInstallConsoleModel(
      events,
      EServerStatus.installing
    );
    const online = buildInstallConsoleModel(events, EServerStatus.online);

    expect(installing.statusText).toBe('Em andamento');
    expect(installing.progress).toBeLessThan(100);
    expect(online.statusText).toBe('Concluída');
    expect(online.progress).toBe(100);
  });

  it('fences delayed events from an older installation session', () => {
    const model = buildInstallConsoleModel(
      [
        item({
          event_id: 'old-complete',
          installation_id: 'install-old',
          install_event_type: 'lifecycle',
          install_status: 'complete',
        }),
        item({
          event_id: 'new-running',
          installation_id: 'install-new',
          install_event_type: 'lifecycle',
          install_status: 'running',
          date: '2026-08-11T21:05:00.000Z',
        }),
      ],
      EServerStatus.installing
    );

    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]?.id).toBe('new-running');
    expect(model.statusText).toBe('Em andamento');
  });

  it('keeps the active session when an older worker emits a delayed event', () => {
    const oldInstallationId = '019c4b70-1000-7000-8000-000000000001';
    const newInstallationId = '019c4b70-2000-7000-8000-000000000002';
    const model = buildInstallConsoleModel(
      [
        item({
          event_id: 'old-running',
          installation_id: oldInstallationId,
          install_event_type: 'lifecycle',
          install_status: 'running',
        }),
        item({
          event_id: 'new-running',
          installation_id: newInstallationId,
          install_event_type: 'lifecycle',
          install_status: 'running',
          date: '2026-08-11T21:05:00.000Z',
        }),
        item({
          event_id: 'old-delayed-output',
          installation_id: oldInstallationId,
          install_event_type: 'output',
          install_stage: 'health',
          output: '200',
          date: '2026-08-11T21:06:00.000Z',
        }),
      ],
      EServerStatus.installing
    );

    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]?.id).toBe('new-running');
    expect(model.statusText).toBe('Em andamento');
  });

  it('starts at zero while no remote event has happened', () => {
    const model = buildInstallConsoleModel([], EServerStatus.new);

    expect(model.progress).toBe(0);
    expect(model.statusText).toBe('Aguardando');
  });

  it('shows parallel Docker layers independently without declaring a full byte counter complete', () => {
    const model = buildInstallConsoleModel(
      [
        item({
          event_id: 'layer-a-full-1',
          output: '320749d0a139: Downloading 261.1MB/261.1MB',
          install_stage: 'worker_wwebjs',
        }),
        item({
          event_id: 'layer-b-progress-1',
          output: 'e3d28d911334: Downloading 259MB/387.3MB',
          install_stage: 'worker_wwebjs',
          date: '2026-08-11T21:00:01.000Z',
        }),
        item({
          event_id: 'layer-a-full-duplicate',
          output: '320749d0a139: Downloading 261.1MB/261.1MB',
          install_stage: 'worker_wwebjs',
          date: '2026-08-11T21:00:02.000Z',
        }),
        item({
          event_id: 'layer-b-progress-2',
          output: 'e3d28d911334: Downloading 261.1MB/387.3MB',
          install_stage: 'worker_wwebjs',
          date: '2026-08-11T21:00:03.000Z',
        }),
      ],
      EServerStatus.installing
    );

    expect(model.entries).toHaveLength(3);
    expect(model.entries[0]?.message).toBe(
      'Camada 320749d0a139: baixando 261,1 MB de 261,1 MB; aguardando confirmação do Docker'
    );
    expect(model.entries[1]?.message).toBe(
      'Camada e3d28d911334: baixando 259 MB de 387,3 MB'
    );
    expect(model.entries[2]?.message).toBe(
      'Camada e3d28d911334: baixando 261,1 MB de 387,3 MB'
    );
    expect(model.statusText).toBe('Em andamento');
    expect(model.progress).toBeLessThan(100);
  });

  it('only labels a Docker layer complete after Docker emits its completion state', () => {
    const model = buildInstallConsoleModel(
      [
        item({
          event_id: 'layer-full',
          output: '320749d0a139: Downloading 261.1MB/261.1MB',
          install_stage: 'worker_wwebjs',
        }),
        item({
          event_id: 'layer-download-complete',
          output: '320749d0a139: Download complete',
          install_stage: 'worker_wwebjs',
          date: '2026-08-11T21:00:01.000Z',
        }),
      ],
      EServerStatus.installing
    );

    expect(model.entries[0]?.message).toContain(
      'aguardando confirmação do Docker'
    );
    expect(model.entries[1]?.message).toBe(
      'Camada 320749d0a139: download confirmado'
    );
  });
});
