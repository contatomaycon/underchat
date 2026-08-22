import { appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = '/home/maycon/underchat';
const playwright =
  '/home/maycon/.codex/skills/playwright/scripts/playwright_cli.sh';
const workerId = process.argv[2];
const socketProvider = process.argv[3];
const pairCount = Number(process.argv[4]);

const providers = {
  baileys: { label: 'Opção 1 (Socket)', name: 'Baileys' },
  whatsmeow: { label: 'Opção 3 (Socket)', name: 'WhatsMeow' },
  wwebjs: { label: 'Opção 2 (Navegador)', name: 'WWebJS' },
};

if (
  !/^[0-9a-f-]{36}$/u.test(workerId || '') ||
  !['baileys', 'whatsmeow'].includes(socketProvider) ||
  !Number.isSafeInteger(pairCount) ||
  pairCount < 1 ||
  pairCount > 100
) {
  throw new Error(
    'usage: node scripts/.codex-visible-migration-soak.mjs <worker_id> baileys|whatsmeow <pairs>'
  );
}

mkdirSync(`${root}/output`, { recursive: true });
const outputPath = `${root}/output/migration-soak-${socketProvider}-${Date.now()}.jsonl`;

function run(command, args, timeout = 360_000) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `command_failed:${command}:${result.status}\n${result.stdout}\n${result.stderr}`
    );
  }
  return result.stdout;
}

function auditOutput(mode) {
  return run('pnpm', [
    'exec',
    'tsx',
    'scripts/.codex-handoff-audit.ts',
    mode,
    workerId,
  ]).trim();
}

function snapshot() {
  return JSON.parse(auditOutput('snapshot'));
}

function parsePlaywrightResult(output) {
  const match = /### Result\n([^\n]+)/u.exec(output);
  if (!match) throw new Error(`playwright_result_missing\n${output}`);
  return JSON.parse(match[1]);
}

function migrationCode(target) {
  const label = providers[target].label;
  const sustainedWaitMs = target === 'wwebjs' ? 35_000 : 10_000;
  return `async page => {
    await page.goto('http://localhost:5173/channels');
    await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1200);
    const visibleFailure = page.getByRole('alertdialog', { name: 'Não foi possível concluir a troca' });
    if (await visibleFailure.isVisible().catch(() => false)) {
      await page.getByTestId('provider-handoff-return').click({ timeout: 120000 });
      await visibleFailure.waitFor({ state: 'hidden', timeout: 30000 });
      await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(1200);
    }
    const visibleSuccess = page.getByText('Conexão bem-sucedida!', { exact: true });
    if (await visibleSuccess.isVisible().catch(() => false)) {
      await page.getByRole('dialog').last().locator('button').first().click();
      await visibleSuccess.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
    const started = Date.now();
    let row = page.locator('tbody tr').filter({ hasText: /^Baileys/ });
    await row.locator('button').filter({ has: page.locator('i.tabler-edit') }).click();
    const edit = page.getByRole('dialog').last();
    await edit.getByText(${JSON.stringify(label)}, { exact: true }).click();
    await edit.getByRole('button', { name: 'Salvar', exact: true }).click();
    const strategy = page.getByRole('dialog').last();
    await strategy.getByRole('button').filter({ hasText: 'Migrar conexão atual' }).click();
    await page.getByText('Conexão bem-sucedida!', { exact: true }).waitFor({
      state: 'visible',
      timeout: 300000,
    });
    const functionalElapsedMs = Date.now() - started;
    if (${sustainedWaitMs} > 0) await page.waitForTimeout(${sustainedWaitMs});
    row = page.locator('tbody tr').filter({ hasText: /^Baileys/ });
    return {
      target: ${JSON.stringify(target)},
      label: ${JSON.stringify(label)},
      functionalElapsedMs,
      sustainedElapsedMs: Date.now() - started,
      rowText: await row.innerText(),
    };
  }`;
}

function runVisibleMigration(target) {
  const output = run(
    playwright,
    ['--session', 'visible', 'run-code', migrationCode(target)],
    360_000
  );
  return parsePlaywrightResult(output);
}

function assertSnapshot(
  state,
  source,
  target,
  fingerprint,
  expectedSourceRevisionId,
  previousHandoffId,
  ui
) {
  const worker = state.worker;
  const handoff = state.handoffs?.[0];
  const operations = state.operations;
  const expected = providers[target];
  const failures = [];
  if (worker.worker_type !== target) failures.push('worker_type');
  if (worker.source_provider !== target) failures.push('source_provider');
  if (worker.session_provider !== target) failures.push('session_provider');
  if (worker.worker_status !== 'online') failures.push('worker_status');
  if (worker.native_status !== 'online') failures.push('native_status');
  if (worker.session_state !== 'ready') failures.push('session_state');
  if (worker.connected !== 'true') failures.push('connected');
  if (worker.authenticated !== 'true') failures.push('authenticated');
  if (worker.session_valid !== 'true') failures.push('session_valid');
  if (worker.qr_available !== 'false') failures.push('qr_available');
  if (worker.central_ack !== true) failures.push('central_ack');
  if (worker.fingerprint !== fingerprint) failures.push('fingerprint');
  if (worker.revision_status !== 'active') failures.push('revision_status');
  if (worker.revision_source !== 'handoff') failures.push('revision_source');
  if (!ui.rowText.includes('Conectado')) failures.push('ui_connected');
  if (!ui.rowText.includes(expected.label)) failures.push('ui_provider');
  if (!handoff || handoff.source_provider !== source)
    failures.push('handoff_source');
  if (!handoff || handoff.target_provider !== target)
    failures.push('handoff_target');
  if (!handoff || handoff.state !== 'completed') failures.push('handoff_state');
  if (!handoff || Number(handoff.attempt_count) !== 0)
    failures.push('handoff_attempt');
  if (!handoff || handoff.error_code !== null) failures.push('handoff_error');
  if (!handoff || handoff.recovery_state !== 'none')
    failures.push('recovery_state');
  if (!handoff || handoff.handoff_id === previousHandoffId)
    failures.push('handoff_not_advanced');
  if (
    !handoff ||
    String(handoff.source_revision_id) !== String(expectedSourceRevisionId)
  )
    failures.push('source_revision_lineage');
  if (
    !handoff ||
    String(handoff.target_revision_id) !== String(worker.active_revision_id)
  )
    failures.push('target_revision_lineage');
  if (
    !handoff ||
    BigInt(handoff.target_revision_id) <= BigInt(expectedSourceRevisionId)
  )
    failures.push('revision_not_monotonic');
  if (Number(operations?.active_handoffs) !== 0)
    failures.push('active_handoffs');
  if (Number(operations?.active_recoveries) !== 0)
    failures.push('active_recoveries');
  if (Number(operations?.active_resolutions) !== 0)
    failures.push('active_resolutions');
  if (failures.length > 0) {
    throw new Error(
      `snapshot_gate_failed:${expected.name}:${failures.join(',')}:${JSON.stringify(state)}`
    );
  }
  return handoff;
}

function assertWwebjsHealth() {
  const raw = auditOutput('health');
  const match = /^200\s+(.+)$/su.exec(raw);
  if (!match) throw new Error(`health_http_failed:${raw}`);
  const health = JSON.parse(match[1]);
  const data = health.data || {};
  const ingress = data.kafka_consumers?.[0];
  const failures = [];
  if (health.status !== true || data.isHealthy !== true)
    failures.push('healthy');
  if (data.reason !== 'Session ready') failures.push('reason');
  if (data.waState !== 'CONNECTED') failures.push('wa_state');
  if (data.session_ready !== true) failures.push('session_ready');
  if (data.connected !== true || data.authenticated !== true)
    failures.push('auth');
  if (data.can_send !== true || data.can_receive_runtime !== true)
    failures.push('traffic');
  if (data.central_online_acknowledged !== true) failures.push('central_ack');
  if (
    data.command_ingress_ready !== true ||
    data.command_ingress_authorized !== true
  )
    failures.push('command_ingress');
  if (ingress?.owner !== 'WorkerCommandJetStreamIngressService')
    failures.push('ingress_owner');
  if (ingress?.connected !== true || ingress?.consuming !== true)
    failures.push('ingress_state');
  if (failures.length > 0) {
    throw new Error(`health_gate_failed:${failures.join(',')}:${raw}`);
  }
  return {
    reason: data.reason,
    waState: data.waState,
    probeLatencyMs: data.probe_latency_ms,
    runtimeGeneration: data.runtime_generation,
    ingressOwner: ingress.owner,
  };
}

function parseDebugEvents(raw) {
  return raw
    .split('\n')
    .map((line) => line.slice(line.indexOf('{')))
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

function assertWwebjsImportProof(revisionId) {
  const events = parseDebugEvents(auditOutput('proof')).filter(
    (event) => String(event.revision_id) === String(revisionId)
  );
  const equivalence = events.findLast(
    (event) =>
      event.event ===
      'handoff.reusable_profile_signal_table_equivalence_evaluated'
  );
  const imported = events.findLast(
    (event) => event.event === 'browser_bridge.canonical_projection_imported'
  );
  const destructiveClear = events.some(
    (event) =>
      event.event === 'browser_bridge.canonical_projection_import_progress' &&
      event.stage === 'clear_signal_tables'
  );
  const componentMatches = equivalence?.component_matches;
  const requiredReusableComponents = [
    'device',
    'identity_keys',
    'pre_keys',
    'pq_pre_keys',
    'pq_pre_key_state',
  ];
  const selectableComponents = [
    'identity_keys',
    'pre_keys',
    'pq_pre_keys',
    'signal_sessions',
    'sender_keys',
  ];
  const expectedPreservedComponents = selectableComponents.filter((name) => {
    if (name === 'pq_pre_keys') {
      return (
        componentMatches?.pq_pre_keys === true &&
        componentMatches?.pq_pre_key_state === true
      );
    }
    return componentMatches?.[name] === true;
  });
  const expectedReplacedComponents = selectableComponents.filter(
    (name) => !expectedPreservedComponents.includes(name)
  );
  const allSelectableComponentsPreserved =
    expectedPreservedComponents.length === selectableComponents.length;
  const failures = [];
  if (!equivalence) failures.push('equivalence_missing');
  if (equivalence?.authority_present !== true) failures.push('authority');
  if (equivalence?.native_projection_present !== true)
    failures.push('native_projection');
  if (equivalence?.app_state_authority_matched !== true)
    failures.push('app_state_authority');
  if (
    !componentMatches ||
    requiredReusableComponents.some((name) => componentMatches[name] !== true)
  )
    failures.push('required_component_matches');
  if (!Array.isArray(equivalence?.mismatched_components))
    failures.push('mismatched_components_missing');
  const expectedMismatchedComponents = Object.entries(componentMatches || {})
    .filter(([, matched]) => matched !== true)
    .map(([name]) => name);
  if (
    JSON.stringify(equivalence?.mismatched_components) !==
    JSON.stringify(expectedMismatchedComponents)
  )
    failures.push('mismatched_components');
  if (!imported) failures.push('imported_missing');
  if (imported?.preserve_existing_app_state !== true)
    failures.push('app_state_preservation');
  if (
    imported?.preserve_existing_signal_tables !==
    allSelectableComponentsPreserved
  )
    failures.push('signal_preservation_contract');
  const expectedImportMode = allSelectableComponentsPreserved
    ? 'preserved_equivalent_bulk_tables'
    : 'selective_component_replace';
  if (imported?.signal_table_import_mode !== expectedImportMode)
    failures.push('signal_import_mode');
  if (
    JSON.stringify(imported?.preserved_signal_components) !==
    JSON.stringify(expectedPreservedComponents)
  )
    failures.push('preserved_components');
  if (
    JSON.stringify(imported?.replaced_signal_components) !==
    JSON.stringify(expectedReplacedComponents)
  )
    failures.push('replaced_components');
  if (destructiveClear) failures.push('clear_signal_tables');
  if (failures.length > 0) {
    throw new Error(
      `wwebjs_import_proof_failed:${failures.join(',')}:${JSON.stringify(events)}`
    );
  }
  return {
    componentMatches,
    preservedComponents: imported.preserved_signal_components,
    replacedComponents: imported.replaced_signal_components,
    signalTableImportMode: imported.signal_table_import_mode,
    appStateImportMode: imported.app_state_import_mode,
    destructiveClear,
  };
}

function assertWwebjsOutboundProof(state, handoff) {
  const prepared = state.handoff_proofs?.find(
    (proof) => proof.handoff_id === handoff.handoff_id
  );
  const sourceAnchor = state.anchors?.find(
    (anchor) =>
      String(anchor.revision_id) === String(handoff.source_revision_id) &&
      anchor.artifact_id === prepared?.profile_artifact_id
  );
  const failures = [];
  if (!prepared) failures.push('prepared_missing');
  if (
    prepared?.profile_checkpoint_mode !== 'full_profile_plus_fresh_canonical_v1'
  )
    failures.push('checkpoint_mode');
  if (!/^[0-9a-f-]{36}$/u.test(prepared?.profile_artifact_id || ''))
    failures.push('artifact_id');
  if (
    !Number.isSafeInteger(Number(prepared?.profile_checkpoint_duration_ms)) ||
    Number(prepared?.profile_checkpoint_duration_ms) < 0
  )
    failures.push('checkpoint_duration');
  if (
    !Number.isSafeInteger(Number(prepared?.size_bytes)) ||
    Number(prepared?.size_bytes) <= 0
  )
    failures.push('profile_size');
  if (
    !Number.isSafeInteger(Number(prepared?.profile_uploaded_bytes)) ||
    Number(prepared?.profile_uploaded_bytes) < 0
  )
    failures.push('uploaded_bytes');
  if (
    !Number.isSafeInteger(Number(prepared?.profile_reused_bytes)) ||
    Number(prepared?.profile_reused_bytes) < 0
  )
    failures.push('reused_bytes');
  if (prepared?.checksum_sha256 !== handoff.source_checkpoint_checksum_sha256)
    failures.push('checkpoint_checksum');
  if (
    String(prepared?.size_bytes) !==
    String(handoff.source_checkpoint_size_bytes)
  )
    failures.push('checkpoint_size');
  if (!sourceAnchor) failures.push('source_anchor');
  if (sourceAnchor?.checkpoint_mode !== 'full_profile_plus_fresh_canonical_v1')
    failures.push('source_anchor_mode');
  if (sourceAnchor?.checksum_sha256 !== prepared?.checksum_sha256)
    failures.push('source_anchor_checksum');
  if (String(sourceAnchor?.size_bytes) !== String(prepared?.size_bytes))
    failures.push('source_anchor_size');
  if (failures.length > 0) {
    throw new Error(
      `wwebjs_outbound_proof_failed:${failures.join(',')}:${JSON.stringify({ prepared, sourceAnchor })}`
    );
  }
  return {
    profileCheckpointMode: prepared.profile_checkpoint_mode,
    profileArtifactId: prepared.profile_artifact_id,
    checkpointDurationMs: Number(prepared.profile_checkpoint_duration_ms),
    profileSizeBytes: Number(prepared.size_bytes),
    uploadedBytes: Number(prepared.profile_uploaded_bytes),
    reusedBytes: Number(prepared.profile_reused_bytes),
  };
}

const initial = snapshot();
const fingerprint = initial.worker.fingerprint;
if (initial.worker.worker_type !== 'wwebjs') {
  throw new Error(
    `initial_provider_must_be_wwebjs:${initial.worker.worker_type}`
  );
}
if (!/^[a-f0-9]{64}$/u.test(fingerprint || '')) {
  throw new Error('initial_fingerprint_invalid');
}
let expectedRevisionId = initial.worker.active_revision_id;
let previousHandoffId = initial.handoffs?.[0]?.handoff_id;

for (let pair = 1; pair <= pairCount; pair += 1) {
  const socketUi = runVisibleMigration(socketProvider);
  const socketState = snapshot();
  const socketHandoff = assertSnapshot(
    socketState,
    'wwebjs',
    socketProvider,
    fingerprint,
    expectedRevisionId,
    previousHandoffId,
    socketUi
  );
  expectedRevisionId = socketHandoff.target_revision_id;
  previousHandoffId = socketHandoff.handoff_id;
  const outboundProof = assertWwebjsOutboundProof(socketState, socketHandoff);
  const socketResult = {
    pair,
    direction: `wwebjs->${socketProvider}`,
    ui: socketUi,
    handoff: socketHandoff,
    outboundProof,
  };
  appendFileSync(outputPath, `${JSON.stringify(socketResult)}\n`);
  process.stdout.write(`${JSON.stringify(socketResult)}\n`);

  const wwebjsUi = runVisibleMigration('wwebjs');
  const wwebjsState = snapshot();
  const wwebjsHandoff = assertSnapshot(
    wwebjsState,
    socketProvider,
    'wwebjs',
    fingerprint,
    expectedRevisionId,
    previousHandoffId,
    wwebjsUi
  );
  expectedRevisionId = wwebjsHandoff.target_revision_id;
  previousHandoffId = wwebjsHandoff.handoff_id;
  const health = assertWwebjsHealth();
  const importProof = assertWwebjsImportProof(wwebjsHandoff.target_revision_id);
  const wwebjsResult = {
    pair,
    direction: `${socketProvider}->wwebjs`,
    ui: wwebjsUi,
    handoff: wwebjsHandoff,
    health,
    importProof,
  };
  appendFileSync(outputPath, `${JSON.stringify(wwebjsResult)}\n`);
  process.stdout.write(`${JSON.stringify(wwebjsResult)}\n`);
}

process.stdout.write(
  `${JSON.stringify({ completed: true, socketProvider, pairCount, outputPath })}\n`
);
