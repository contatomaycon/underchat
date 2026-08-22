import { EServerStatus } from '@core/common/enums/EServerStatus';
import type {
  ServerInstallEventType,
  ServerInstallStageId,
  ServerInstallStageStatus,
  ServerInstallStatus,
} from '@core/common/interfaces/IServerInstallEvent';

export type InstallConsoleSeverity = 'info' | 'success' | 'warning' | 'error';

export type InstallConsoleStageId = ServerInstallStageId;

export interface InstallConsoleSourceItem {
  command: string | null;
  output: string | null;
  date: string | Date;
  event_id?: string;
  installation_id?: string;
  install_event_type?: ServerInstallEventType;
  install_stage?: ServerInstallStageId;
  install_stage_status?: ServerInstallStageStatus;
  install_status?: ServerInstallStatus;
}

export interface InstallConsoleEntry {
  id: string;
  commandLabel: string;
  date: string | Date;
  dateMs: number;
  message: string;
  severity: InstallConsoleSeverity;
  stageId: InstallConsoleStageId;
  eventType?: ServerInstallEventType;
  stageStatus?: ServerInstallStageStatus;
  installStatus?: ServerInstallStatus;
}

export interface InstallConsoleStage {
  id: InstallConsoleStageId;
  title: string;
  description: string;
  icon: string;
  status: 'pending' | 'running' | 'complete' | 'error' | 'canceled';
}

export interface InstallConsoleModel {
  entries: InstallConsoleEntry[];
  errorCount: number;
  latestAt: string | Date | null;
  progress: number;
  statusColor: string;
  statusIcon: string;
  statusText: string;
  stages: InstallConsoleStage[];
  warningCount: number;
}

const ansiRegex = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const hexIdRegex = /^[a-f0-9]{64}$/i;
const imageStageIds = new Set<InstallConsoleStageId>([
  'images',
  'worker_baileys',
  'worker_wwebjs',
  'worker_meow',
  'balance',
]);

const stageDefinitions: Array<Omit<InstallConsoleStage, 'status'>> = [
  {
    id: 'queued',
    title: 'Preparação',
    description: 'Conexão SSH e validações iniciais',
    icon: 'tabler-plug-connected',
  },
  {
    id: 'packages',
    title: 'Sistema',
    description: 'Pacotes, Node, NVM e dependências',
    icon: 'tabler-package',
  },
  {
    id: 'docker',
    title: 'Docker',
    description: 'Engine, compose, rede e permissão',
    icon: 'tabler-settings',
  },
  {
    id: 'images',
    title: 'Harbor',
    description: 'Login e base das imagens',
    icon: 'tabler-download',
  },
  {
    id: 'worker_baileys',
    title: 'Worker Opção 1',
    description: 'Pull e tag da imagem da Opção 1',
    icon: 'tabler-brand-whatsapp',
  },
  {
    id: 'worker_wwebjs',
    title: 'Worker Opção 2',
    description: 'Pull e tag da imagem da Opção 2',
    icon: 'tabler-browser',
  },
  {
    id: 'worker_meow',
    title: 'Worker Opção 3',
    description: 'Pull e tag da imagem da Opção 3',
    icon: 'tabler-brand-whatsapp',
  },
  {
    id: 'balance',
    title: 'Balance API',
    description: 'Container principal e portas reservadas',
    icon: 'tabler-server',
  },
  {
    id: 'health',
    title: 'Validação',
    description: 'Imagens locais e health check HTTP',
    icon: 'tabler-heartbeat',
  },
];

const stageIndexById = new Map<InstallConsoleStageId, number>(
  stageDefinitions.map((stage, index) => [stage.id, index])
);

function stripAnsiCodes(value: string): string {
  return value.replace(ansiRegex, '');
}

function redactSensitiveValues(value: string): string {
  return value.replace(
    /\b([A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|KEY)[A-Z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
    '$1=***'
  );
}

function normalizeTerminalOutput(output: string | null): string {
  if (!output) {
    return '';
  }

  return redactSensitiveValues(stripAnsiCodes(output))
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) {
        return line;
      }

      const repaints = line.split('\r').filter((value) => value.trim());
      return repaints.at(-1) ?? '';
    })
    .join('\n')
    .replace(/[ \t]+\n/g, '\n');
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function formatDockerSize(value: string, unit: string): string {
  return `${value.replace('.', ',')} ${unit}`;
}

function dockerLayerFriendlyMessage(message: string): string | null {
  const progress = message.match(
    /^([a-f0-9]{12,64}):\s+(Downloading|Extracting)\s+([0-9.]+)\s*([kmgt]?(?:i)?b)\/([0-9.]+)\s*([kmgt]?(?:i)?b)$/iu
  );

  if (progress) {
    const [, layerId, operation, current, currentUnit, total, totalUnit] =
      progress;
    const action =
      operation.toLowerCase() === 'extracting' ? 'extraindo' : 'baixando';
    const sameRoundedAmount =
      current === total &&
      currentUnit.toLowerCase() === totalUnit.toLowerCase();
    const confirmation = sameRoundedAmount
      ? '; aguardando confirmação do Docker'
      : '';

    return `Camada ${layerId}: ${action} ${formatDockerSize(
      current,
      currentUnit
    )} de ${formatDockerSize(total, totalUnit)}${confirmation}`;
  }

  const state = message.match(
    /^([a-f0-9]{12,64}):\s+(Download complete|Pull complete|Verifying Checksum|Already exists|Waiting)$/iu
  );
  if (!state) return null;

  const [, layerId, rawState] = state;
  const stateMessages: Record<string, string> = {
    'download complete': 'download confirmado',
    'pull complete': 'extração concluída',
    'verifying checksum': 'verificando integridade',
    'already exists': 'já disponível no servidor',
    waiting: 'aguardando outras camadas',
  };

  return `Camada ${layerId}: ${stateMessages[rawState.toLowerCase()]}`;
}

function dockerLayerMessageKey(message: string): string | null {
  const match = message.match(/^Camada ([a-f0-9]{12,64}):/iu);
  return match?.[1]?.toLowerCase() ?? null;
}

function stageIndex(stageId: InstallConsoleStageId): number {
  return stageIndexById.get(stageId) ?? 0;
}

function mostAdvancedStage(
  currentStage: InstallConsoleStageId,
  nextStage: InstallConsoleStageId
): InstallConsoleStageId {
  return stageIndex(nextStage) >= stageIndex(currentStage)
    ? nextStage
    : currentStage;
}

function reachedStageIndex(entries: InstallConsoleEntry[]): number {
  return entries.reduce(
    (highestIndex, entry) => Math.max(highestIndex, stageIndex(entry.stageId)),
    0
  );
}

function commandLabel(command: string | null): string {
  const normalized = compactText(stripAnsiCodes(command ?? ''));

  if (!normalized) {
    return 'Evento de instalação';
  }

  if (normalized.includes('UNDERCHAT_LEGACY_BALANCE_')) {
    return 'Instalação base, Docker, imagens e Balance API';
  }

  if (normalized === 'Install base packages, Docker, images and Balance API') {
    return 'Instalação base, Docker, imagens e Balance API';
  }

  if (
    normalized.includes('/v1/health/check') ||
    normalized === 'Check Balance API health'
  ) {
    return 'Health check do Balance API';
  }

  if (
    normalized.includes('docker image inspect') ||
    normalized === 'Check required Docker images'
  ) {
    return 'Verificação das imagens Docker';
  }

  if (
    normalized.includes('docker logs under-balance-api') ||
    normalized === 'Read Balance API container logs'
  ) {
    return 'Logs do container Balance API';
  }

  if (
    normalized.includes('docker ps') ||
    normalized === 'Inspect Docker runtime'
  ) {
    return 'Inspeção do Docker';
  }

  if (normalized.length <= 90) {
    return normalized;
  }

  return `${normalized.slice(0, 87)}...`;
}

function isTransientInstallIssue(text: string): boolean {
  const normalized = text.toLowerCase();

  return (
    normalized.includes('managed rollout fence busy') ||
    normalized.includes('managed rollout lock is busy') ||
    normalized.includes('managed rollout service is active') ||
    normalized.includes('managed rollout phase:') ||
    normalized.includes('lock detectado') ||
    normalized.includes('is another process using it') ||
    normalized.includes('could not get lock') ||
    normalized.includes('dpkg frontend lock') ||
    normalized.includes('splitting up /var/lib/apt/lists') ||
    normalized.includes('previous index files will be used') ||
    normalized.includes('credentials are stored unencrypted')
  );
}

function detectSeverity(text: string): InstallConsoleSeverity {
  const normalized = text.toLowerCase();

  if (isTransientInstallIssue(text)) {
    return 'warning';
  }

  if (
    normalized.includes('error:') ||
    normalized.includes('failed') ||
    normalized.includes('fatal error') ||
    normalized.includes('falha') ||
    normalized.includes('unable to') ||
    normalized.includes('cannot')
  ) {
    return 'error';
  }

  if (
    normalized.includes('warning') ||
    normalized.includes('warn') ||
    normalized.includes('lock detectado') ||
    normalized.includes('retry')
  ) {
    return 'warning';
  }

  if (
    normalized.includes('success:') ||
    normalized === '200' ||
    normalized === 'true' ||
    normalized.includes('login succeeded') ||
    normalized.includes('complete')
  ) {
    return 'success';
  }

  return 'info';
}

function detectSpecificImageStage(text: string): InstallConsoleStageId | null {
  const normalized = text.toLowerCase();

  if (normalized.includes('under-worker-baileys')) {
    return 'worker_baileys';
  }

  if (normalized.includes('under-worker-wwebjs')) {
    return 'worker_wwebjs';
  }

  if (
    normalized.includes('under-worker-whatsmeow') ||
    normalized.includes('worker-whatsmeow') ||
    normalized.includes('whatsmeow')
  ) {
    return 'worker_meow';
  }

  if (normalized.includes('under-balance-api')) {
    return 'balance';
  }

  return null;
}

function isGenericLegacyInstallCommand(command: string | null): boolean {
  const normalized = stripAnsiCodes(command ?? '').trim();

  return (
    normalized.includes('UNDERCHAT_LEGACY_BALANCE_') ||
    normalized === 'Install base packages, Docker, images and Balance API'
  );
}

function isDockerImageProgress(message: string): boolean {
  const normalized = message.toLowerCase();
  const compactMessage = normalized.trim();

  return (
    /^sha256:[a-f0-9]{12,}$/i.test(compactMessage) ||
    /^[a-f0-9]{12,64}:$/i.test(compactMessage) ||
    normalized.includes('pulling from') ||
    normalized.includes('pull complete') ||
    normalized.includes('download complete') ||
    normalized.includes('downloading') ||
    normalized.includes('extracting') ||
    normalized.includes('verifying checksum') ||
    normalized.includes('already exists') ||
    normalized.includes('error response from daemon') ||
    normalized.includes('failed to copy') ||
    normalized.includes('failed commit') ||
    normalized.includes('/var/lib/containerd/') ||
    normalized.includes('digest: sha256:') ||
    normalized.includes('status: image is up to date') ||
    normalized.includes('status: downloaded newer image') ||
    normalized.includes('docker pull failed') ||
    normalized.includes('docker tag failed') ||
    (normalized.startsWith('camada ') &&
      (normalized.includes(': baixando ') ||
        normalized.includes(': extraindo ') ||
        normalized.includes(': download confirmado') ||
        normalized.includes(': extração concluída') ||
        normalized.includes(': verificando integridade') ||
        normalized.includes(': aguardando outras camadas')))
  );
}

function detectStage(
  command: string | null,
  message: string,
  currentStage: InstallConsoleStageId
): InstallConsoleStageId {
  const commandText = isGenericLegacyInstallCommand(command)
    ? ''
    : (command ?? '');
  const normalized = `${commandText} ${message}`.toLowerCase();
  const compactMessage = message.trim().toLowerCase();
  const specificStage = detectSpecificImageStage(`${commandText} ${message}`);

  if (specificStage) {
    return specificStage;
  }

  if (
    normalized.includes('/v1/health/check') ||
    compactMessage === '200' ||
    normalized.includes('health/check') ||
    normalized.includes('check required docker images') ||
    normalized.includes('docker image inspect')
  ) {
    return 'health';
  }

  if (
    normalized.includes('container under-balance-api') ||
    normalized.includes('under-balance-api started') ||
    normalized.includes('docker run -d --name under-balance-api') ||
    normalized.includes('reserved balance port')
  ) {
    return 'balance';
  }

  if (isDockerImageProgress(message)) {
    return imageStageIds.has(currentStage) ? currentStage : 'images';
  }

  if (
    normalized.includes('harbor') ||
    normalized.includes('docker pull') ||
    normalized.includes('docker tag') ||
    normalized.includes('login succeeded')
  ) {
    return 'images';
  }

  if (
    normalized.includes('docker') ||
    normalized.includes('containerd') ||
    normalized.includes('/var/run/docker.sock')
  ) {
    return 'docker';
  }

  if (
    normalized.includes('apt-get') ||
    normalized.includes('dpkg') ||
    normalized.includes('package') ||
    normalized.includes('nvm') ||
    normalized.includes('node')
  ) {
    return 'packages';
  }

  return 'queued';
}

function commandLabelForStage(
  label: string,
  stageId: InstallConsoleStageId
): string {
  if (stageId === 'worker_baileys') return 'Worker Opção 1';
  if (stageId === 'worker_wwebjs') return 'Worker Opção 2';
  if (stageId === 'worker_meow') return 'Worker Opção 3';
  if (stageId === 'balance') return 'Balance API';

  return label;
}

function friendlyMessage(command: string | null, message: string): string {
  const trimmed = compactText(message);
  const lowerCommand = (command ?? '').toLowerCase();

  if (!trimmed) {
    return '';
  }

  const dockerLayerMessage = dockerLayerFriendlyMessage(trimmed);
  if (dockerLayerMessage) return dockerLayerMessage;

  if (hexIdRegex.test(trimmed)) {
    return `Container criado: ${trimmed.slice(0, 12)}`;
  }

  const containerStarted = trimmed.match(
    /^SUCCESS: Container under-balance-api started with ID: ([a-f0-9]{12,64})$/iu
  );
  if (containerStarted?.[1]) {
    return `Balance API iniciado: ${containerStarted[1].slice(0, 12)}`;
  }

  if (lowerCommand.includes('/v1/health/check') && trimmed === '200') {
    return 'Balance API respondeu HTTP 200';
  }

  if (lowerCommand.includes('docker image inspect') && trimmed === 'true') {
    return 'Imagens Docker obrigatórias disponíveis';
  }

  if (trimmed.includes('Reading package lists')) {
    return trimmed.replace('Reading package lists', 'Lendo listas de pacotes');
  }

  return trimmed;
}

function dateToMs(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();

  return Number.isFinite(ms) ? ms : 0;
}

function selectLatestInstallationItems(
  items: InstallConsoleSourceItem[]
): InstallConsoleSourceItem[] {
  const structuredItems = items.filter((item) => item.installation_id);
  const latestRunningLifecycle = [...structuredItems]
    .filter(
      (item) =>
        item.install_event_type === 'lifecycle' &&
        (item.install_status === 'queued' || item.install_status === 'running')
    )
    .sort((a, b) => dateToMs(b.date) - dateToMs(a.date))
    .at(0);

  const installationIds = [
    ...new Set(
      structuredItems
        .map((item) => item.installation_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const allIdsAreUuidV7 = installationIds.every((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    )
  );
  const latestInstallationId = latestRunningLifecycle?.installation_id
    ? latestRunningLifecycle.installation_id
    : allIdsAreUuidV7
      ? [...installationIds].sort().at(-1)
      : [...structuredItems]
          .sort((a, b) => dateToMs(b.date) - dateToMs(a.date))
          .at(0)?.installation_id;

  if (!latestInstallationId) {
    return items;
  }

  return items.filter((item) => item.installation_id === latestInstallationId);
}

function structuredEventMessage(item: InstallConsoleSourceItem): string | null {
  if (item.install_event_type === 'stage' && item.install_stage) {
    const definition = stageDefinitions.find(
      (stage) => stage.id === item.install_stage
    );
    const stageName = definition?.title ?? item.install_stage;

    if (item.install_stage_status === 'running') {
      return `Iniciando etapa: ${stageName}`;
    }
    if (item.install_stage_status === 'complete') {
      return `Etapa concluída: ${stageName}`;
    }
    if (item.install_stage_status === 'error') {
      return `Falha na etapa: ${stageName}`;
    }
  }

  if (item.install_event_type === 'lifecycle' && item.install_status) {
    const messages: Record<ServerInstallStatus, string> = {
      queued: 'Instalação aguardando execução',
      running: 'Instalação iniciada no servidor',
      complete: 'Instalação concluída e validada',
      error: 'Instalação encerrada com erro',
      canceled: 'Instalação cancelada',
    };

    return messages[item.install_status];
  }

  return null;
}

function structuredEventSeverity(
  item: InstallConsoleSourceItem
): InstallConsoleSeverity | null {
  if (
    item.install_stage_status === 'error' ||
    item.install_status === 'error'
  ) {
    return 'error';
  }

  if (item.install_status === 'canceled') {
    return 'warning';
  }

  if (
    item.install_stage_status === 'complete' ||
    item.install_status === 'complete'
  ) {
    return 'success';
  }

  return item.install_event_type ? 'info' : null;
}

function buildEntries(
  items: InstallConsoleSourceItem[]
): InstallConsoleEntry[] {
  const sortedItems = [...selectLatestInstallationItems(items)].sort(
    (a, b) => dateToMs(a.date) - dateToMs(b.date)
  );
  const entries: InstallConsoleEntry[] = [];
  let currentStage: InstallConsoleStageId = 'queued';
  const latestDockerProgressByLayer = new Map<string, string>();

  for (const item of sortedItems) {
    const structuredMessage = structuredEventMessage(item);
    const lines = structuredMessage
      ? [structuredMessage]
      : normalizeTerminalOutput(item.output)
          .split('\n')
          .map(friendlyMessage.bind(null, item.command))
          .filter(Boolean);
    const label = commandLabel(item.command);

    for (const line of lines) {
      const stageId: InstallConsoleStageId =
        item.install_stage ?? detectStage(item.command, line, currentStage);
      currentStage = item.install_stage
        ? item.install_stage
        : mostAdvancedStage(currentStage, stageId);
      const severity = structuredEventSeverity(item) ?? detectSeverity(line);
      const id =
        item.event_id ??
        `${dateToMs(item.date)}:${entries.length}:${stageId}:${line}`;
      const last = entries.at(-1);
      const comparable = `${stageId}:${severity}:${line}`;
      const layerKey = dockerLayerMessageKey(line);

      if (
        last &&
        `${last.stageId}:${last.severity}:${last.message}` === comparable
      ) {
        continue;
      }
      if (layerKey && latestDockerProgressByLayer.get(layerKey) === line) {
        continue;
      }

      if (layerKey) latestDockerProgressByLayer.set(layerKey, line);

      entries.push({
        id,
        commandLabel: commandLabelForStage(label, stageId),
        date: item.date,
        dateMs: dateToMs(item.date),
        message: line,
        severity,
        stageId,
        eventType: item.install_event_type,
        stageStatus: item.install_stage_status,
        installStatus: item.install_status,
      });
    }
  }

  return entries;
}

function isHealthSuccessEntry(entry: InstallConsoleEntry): boolean {
  return (
    entry.stageId === 'health' &&
    entry.severity === 'success' &&
    (entry.message.includes('HTTP 200') || entry.message === '200')
  );
}

function hasHealthSuccess(entries: InstallConsoleEntry[]): boolean {
  return entries.some(isHealthSuccessEntry);
}

function normalizeEntrySeverities(
  entries: InstallConsoleEntry[]
): InstallConsoleEntry[] {
  return entries.map((entry) => {
    if (entry.severity !== 'error') {
      return entry;
    }

    if (isTransientInstallIssue(entry.message)) {
      return {
        ...entry,
        severity: 'warning',
      };
    }

    return entry;
  });
}

function latestLifecycleStatus(
  entries: InstallConsoleEntry[]
): ServerInstallStatus | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const status = entries[index]?.installStatus;
    if (status) return status;
  }

  return null;
}

function resolveInstallStatus(
  entries: InstallConsoleEntry[],
  serverStatus?: EServerStatus | string | null
): ServerInstallStatus {
  if (serverStatus === EServerStatus.installing) return 'running';
  if (serverStatus === EServerStatus.new) return 'queued';
  if (serverStatus === EServerStatus.online) return 'complete';
  if (serverStatus === EServerStatus.error) return 'error';
  if (serverStatus === EServerStatus.canceled) return 'canceled';

  const lifecycleStatus = latestLifecycleStatus(entries);
  if (lifecycleStatus) return lifecycleStatus;
  if (hasHealthSuccess(entries)) return 'complete';
  if (entries.some((entry) => entry.severity === 'error')) return 'error';
  if (entries.length > 0) return 'running';

  return 'queued';
}

export function buildInstallConsoleModel(
  items: InstallConsoleSourceItem[],
  serverStatus?: EServerStatus | string | null
): InstallConsoleModel {
  const entries = normalizeEntrySeverities(buildEntries(items));
  const errorCount = entries.filter(
    (entry) => entry.severity === 'error'
  ).length;
  const warningCount = entries.filter(
    (entry) => entry.severity === 'warning'
  ).length;
  const latestEntry = entries.at(-1);
  const activeStageIndex = reachedStageIndex(entries);
  const installStatus = resolveInstallStatus(entries, serverStatus);
  const completed = installStatus === 'complete';
  const statusTextByState: Record<ServerInstallStatus, string> = {
    queued: 'Aguardando',
    running: 'Em andamento',
    complete: 'Concluída',
    error: 'Com erro',
    canceled: 'Cancelada',
  };
  const statusColorByState: Record<ServerInstallStatus, string> = {
    queued: 'secondary',
    running: 'warning',
    complete: 'success',
    error: 'error',
    canceled: 'secondary',
  };
  const statusIconByState: Record<ServerInstallStatus, string> = {
    queued: 'tabler-clock',
    running: 'tabler-loader-2',
    complete: 'tabler-circle-check',
    error: 'tabler-alert-triangle',
    canceled: 'tabler-player-stop',
  };
  const statusText = statusTextByState[installStatus];
  const statusColor = statusColorByState[installStatus];
  const statusIcon = statusIconByState[installStatus];
  const progress = completed
    ? 100
    : entries.length === 0
      ? 0
      : Math.round(
          ((Math.min(activeStageIndex + 1, stageDefinitions.length) - 0.35) /
            stageDefinitions.length) *
            100
        );
  const hasStructuredStages = entries.some(
    (entry) => entry.eventType === 'stage' && entry.stageStatus
  );
  const structuredStageStatuses = new Map<
    InstallConsoleStageId,
    ServerInstallStageStatus
  >();
  for (const entry of entries) {
    if (entry.eventType === 'stage' && entry.stageStatus) {
      structuredStageStatuses.set(entry.stageId, entry.stageStatus);
    }
  }

  const stages = stageDefinitions.map((stage, index) => {
    const hasStageError = entries.some(
      (entry) => entry.stageId === stage.id && entry.severity === 'error'
    );
    const structuredStatus = structuredStageStatuses.get(stage.id);
    let status: InstallConsoleStage['status'];

    if (completed) {
      status = 'complete';
    } else if (structuredStatus) {
      status = structuredStatus;
    } else if (hasStructuredStages) {
      status = 'pending';
    } else if (hasStageError) {
      status = 'error';
    } else if (index < activeStageIndex) {
      status = 'complete';
    } else if (index === activeStageIndex && entries.length > 0) {
      status = 'running';
    } else {
      status = 'pending';
    }

    if (
      index === activeStageIndex &&
      status === 'running' &&
      installStatus === 'error'
    ) {
      status = 'error';
    }

    if (
      index === activeStageIndex &&
      status === 'running' &&
      installStatus === 'canceled'
    ) {
      status = 'canceled';
    }

    return { ...stage, status };
  });

  return {
    entries,
    errorCount,
    latestAt: latestEntry?.date ?? null,
    progress: Math.max(0, Math.min(100, progress)),
    statusColor,
    statusIcon,
    statusText,
    stages,
    warningCount,
  };
}
