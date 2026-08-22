import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspaceRoot = process.cwd();
const canaryPath = path.resolve(
  workspaceRoot,
  'scripts/whatsapp-provider-handoff-live-canary.mjs'
);
const canaryUrl = pathToFileURL(canaryPath).href;
const canarySource = fs.readFileSync(canaryPath, 'utf8');

function runCanaryModuleTest(body: string): void {
  const source = `
    import assert from 'node:assert/strict';
    import {
      CANARY_LOGIN_SESSION_PLATFORM,
      DIRECTED_HANDOFF_SEQUENCE,
      WHATSAPP_OPTIONS,
      assertDurableHandoffEvidence,
      canRequestSafeHandoffReturn,
      centrifugoWebsocketUrl,
      detectInteractiveLoginEvidence,
      directedHandoffSequenceFrom,
      handoffMatchesOperation,
      isInitialProviderSafelyRestored,
      isResolvedHandoff,
      publicApiUrl,
      resolveAuthenticationToken,
      workerHealthErrors,
    } from ${JSON.stringify(canaryUrl)};
    ${body}
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    stdio: 'pipe',
    timeout: 5_000,
  });
}

describe('WhatsApp provider handoff live canary', () => {
  it('uses only normal manager API calls and refuses an accidental live run', () => {
    expect(canarySource).toContain("'PATCH'");
    expect(canarySource).toContain('/provider-handoff/latest');
    expect(canarySource).toContain('/provider-handoff/evidence');
    expect(canarySource).toContain("'/centrifugo/auth/token'");
    expect(canarySource).toContain('new Centrifuge');
    expect(canarySource).toContain("body: { action: 'return' }");
    expect(canarySource).toContain('--confirm-live');
    expect(canarySource).not.toContain("from 'pg'");
    expect(canarySource).not.toContain("from 'ioredis'");
    expect(canarySource).not.toContain('node:child_process');
  });

  it('uses the imported Centrifuge connection state in the realtime gate', () => {
    expect(canarySource).toContain('State as CentrifugeState');
    expect(canarySource).toContain(
      'client.state === CentrifugeState.Connected'
    );
    expect(canarySource).not.toContain('CentrifugoState');
  });

  it('reads the worker and latest handoff exactly once per compensation poll', () => {
    expect(canarySource).toMatch(
      /const \[current, handoff\] = await Promise\.all\(\[\s*readWorker\(options\.workerId\),\s*viewLatestHandoff\(options\.workerId\),\s*\]\);/u
    );
    expect(canarySource).not.toMatch(
      /const \[current, handoff\] = await Promise\.all\(\[\s*readWorker\(options\.workerId\),\s*readWorker\(options\.workerId\)/u
    );
  });

  it('normalizes the Centrifugo base URL to the websocket endpoint', () => {
    runCanaryModuleTest(`
      assert.equal(
        centrifugoWebsocketUrl('ws://localhost:8000'),
        'ws://localhost:8000/connection/websocket',
      );
      assert.equal(
        centrifugoWebsocketUrl(' ws://localhost:8000/ '),
        'ws://localhost:8000/connection/websocket',
      );
      assert.equal(
        centrifugoWebsocketUrl('wss://centrifugo.example/connection/websocket'),
        'wss://centrifugo.example/connection/websocket',
      );
      assert.throws(() => centrifugoWebsocketUrl('   '), /did not include a URL/);
    `);
  });

  it('removes credentials, query tokens and fragments from the reported API URL', () => {
    runCanaryModuleTest(`
      assert.equal(
        publicApiUrl('https://user:secret@example.test/v1/?token=sensitive#fragment'),
        'https://example.test/v1',
      );
      assert.equal(publicApiUrl('not a url'), 'invalid_api_url');
    `);
  });

  it('prefers an injected token and keeps credential login isolated from web', () => {
    runCanaryModuleTest(`
      const previousToken = process.env.HANDOFF_CANARY_TOKEN;
      let loginCalls = 0;

      try {
        process.env.HANDOFF_CANARY_TOKEN = '  canary-token  ';
        assert.equal(
          await resolveAuthenticationToken(async () => {
            loginCalls += 1;
            return 'login-token';
          }),
          'canary-token',
        );
        assert.equal(loginCalls, 0);

        delete process.env.HANDOFF_CANARY_TOKEN;
        assert.equal(
          await resolveAuthenticationToken(async () => {
            loginCalls += 1;
            return 'login-token';
          }),
          'login-token',
        );
        assert.equal(loginCalls, 1);
        assert.equal(CANARY_LOGIN_SESSION_PLATFORM, 'mobile');
      } finally {
        if (previousToken === undefined) {
          delete process.env.HANDOFF_CANARY_TOKEN;
        } else {
          process.env.HANDOFF_CANARY_TOKEN = previousToken;
        }
      }
    `);
  });

  it('requires an injected token when dry-run must remain GET-only', () => {
    runCanaryModuleTest(`
      const previousToken = process.env.HANDOFF_CANARY_TOKEN;
      let loginCalls = 0;
      try {
        delete process.env.HANDOFF_CANARY_TOKEN;
        await assert.rejects(
          resolveAuthenticationToken(
            async () => {
              loginCalls += 1;
              return 'login-token';
            },
            { allowLogin: false },
          ),
          /GET-only dry-run/,
        );
        assert.equal(loginCalls, 0);
      } finally {
        if (previousToken === undefined) {
          delete process.env.HANDOFF_CANARY_TOKEN;
        } else {
          process.env.HANDOFF_CANARY_TOKEN = previousToken;
        }
      }
    `);
  });

  it('covers each directed provider swap exactly once and returns to Option 1', () => {
    runCanaryModuleTest(`
      assert.equal(DIRECTED_HANDOFF_SEQUENCE.length, 6);
      assert.equal(DIRECTED_HANDOFF_SEQUENCE[0].from, WHATSAPP_OPTIONS.option1);
      assert.equal(
        DIRECTED_HANDOFF_SEQUENCE[DIRECTED_HANDOFF_SEQUENCE.length - 1].to,
        WHATSAPP_OPTIONS.option1,
      );

      const pairs = DIRECTED_HANDOFF_SEQUENCE.map(({ from, to }) =>
        \`${'${'}from.provider}:${'${'}to.provider}\`,
      );
      assert.deepEqual(new Set(pairs), new Set([
        'baileys:whatsmeow',
        'baileys:wwebjs',
        'whatsmeow:baileys',
        'whatsmeow:wwebjs',
        'wwebjs:baileys',
        'wwebjs:whatsmeow',
      ]));
    `);
  });

  it('rotates the full directed matrix around any of the three live canaries', () => {
    runCanaryModuleTest(`
      for (const option of Object.values(WHATSAPP_OPTIONS)) {
        const sequence = directedHandoffSequenceFrom(option);
        assert.equal(sequence.length, 6);
        assert.equal(sequence[0].from, option);
        assert.equal(sequence[sequence.length - 1].to, option);
        assert.deepEqual(
          new Set(sequence.map(({ from, to }) =>
            \`${'${'}from.provider}:${'${'}to.provider}\`,
          )),
          new Set([
            'baileys:whatsmeow',
            'baileys:wwebjs',
            'whatsmeow:baileys',
            'whatsmeow:wwebjs',
            'wwebjs:baileys',
            'wwebjs:whatsmeow',
          ]),
        );
      }
    `);
  });

  it('requires the API-visible proof of preserved, acknowledged Postgres session', () => {
    runCanaryModuleTest(`
      const baseline = { workerId: 'worker-1', number: '5561999999999' };
      const healthy = {
        id: baseline.workerId,
        session_storage: 'postgres',
        number: baseline.number,
        type: { id: WHATSAPP_OPTIONS.option2.id },
        status: { name: 'online' },
        lifecycle_operation_id: null,
        connection_online_acknowledged: true,
        connection_status: {
          provider: WHATSAPP_OPTIONS.option2.provider,
          status: 'online',
          connected: true,
          authenticated: true,
          sessionValid: true,
          qrAvailable: false,
        },
      };

      assert.deepEqual(
        workerHealthErrors(healthy, WHATSAPP_OPTIONS.option2, baseline),
        [],
      );
      assert.ok(
        workerHealthErrors(
          {
            ...healthy,
            connection_status: {
              ...healthy.connection_status,
              sessionValid: false,
              qrAvailable: true,
            },
          },
          WHATSAPP_OPTIONS.option2,
          baseline,
        ).length > 0,
      );
    `);
  });

  it('correlates every observation with the lifecycle operation acknowledged by PATCH', () => {
    runCanaryModuleTest(`
      assert.equal(
        handoffMatchesOperation(
          { handoff_lifecycle_operation_id: 'operation-1' },
          'operation-1',
        ),
        true,
      );
      assert.equal(
        handoffMatchesOperation(
          { lifecycle_operation_id: 'operation-1' },
          'operation-1',
        ),
        true,
      );
      assert.equal(
        handoffMatchesOperation(
          { handoff_lifecycle_operation_id: 'operation-other' },
          'operation-1',
        ),
        false,
      );
    `);
  });

  it('allows only fully compensated historical failures before a new canary', () => {
    runCanaryModuleTest(`
      const recovered = {
        state: 'failed',
        source_revision_preserved: true,
        source_runtime_restored: true,
        recovery_state: 'completed',
        resolution_required: false,
        resolution_state: 'completed',
      };
      assert.equal(isResolvedHandoff(recovered), true);
      assert.equal(
        isResolvedHandoff({ ...recovered, recovery_state: 'running' }),
        false,
      );
      assert.equal(
        isResolvedHandoff({ ...recovered, source_runtime_restored: false }),
        false,
      );
      assert.equal(
        isResolvedHandoff({ ...recovered, resolution_required: true }),
        false,
      );
    `);
  });

  it('permits compensation to request only a preserved non-destructive return', () => {
    runCanaryModuleTest(`
      const safe = {
        handoff_id: '00000000-0000-4000-8000-000000000001',
        state: 'failed',
        source_revision_preserved: true,
        can_return: true,
        resolution_action: null,
      };
      assert.equal(canRequestSafeHandoffReturn(safe), true);
      assert.equal(
        canRequestSafeHandoffReturn({ ...safe, source_revision_preserved: false }),
        false,
      );
      assert.equal(
        canRequestSafeHandoffReturn({ ...safe, can_return: false }),
        false,
      );
      assert.equal(
        canRequestSafeHandoffReturn({ ...safe, resolution_action: 'discard' }),
        false,
      );
      assert.equal(
        canRequestSafeHandoffReturn({ ...safe, state: 'completed' }),
        false,
      );
    `);
  });

  it('does not declare compensation complete while a handoff is unresolved', () => {
    runCanaryModuleTest(`
      const baseline = { workerId: 'worker-1', number: '5561999999999' };
      const current = {
        id: baseline.workerId,
        session_storage: 'postgres',
        number: baseline.number,
        type: { id: WHATSAPP_OPTIONS.option1.id },
        status: { name: 'online' },
        lifecycle_operation_id: null,
        connection_online_acknowledged: true,
        connection_status: {
          provider: WHATSAPP_OPTIONS.option1.provider,
          status: 'online',
          connected: true,
          authenticated: true,
          sessionValid: true,
          qrAvailable: false,
        },
      };
      const unresolved = {
        state: 'failed',
        source_revision_preserved: true,
        source_runtime_restored: true,
        recovery_state: 'completed',
        resolution_required: true,
        resolution_state: null,
      };

      assert.equal(isInitialProviderSafelyRestored({
        current,
        handoff: null,
        initialOption: WHATSAPP_OPTIONS.option1,
        baselineIdentity: baseline,
      }), true);
      assert.equal(isInitialProviderSafelyRestored({
        current,
        handoff: unresolved,
        initialOption: WHATSAPP_OPTIONS.option1,
        baselineIdentity: baseline,
      }), false);
      assert.equal(isInitialProviderSafelyRestored({
        current,
        handoff: { state: 'completed', recovery_state: 'completed' },
        initialOption: WHATSAPP_OPTIONS.option1,
        baselineIdentity: baseline,
      }), true);
    `);
  });

  it('detects QR, pairing and passkey evidence without retaining credentials', () => {
    runCanaryModuleTest(`
      const evidence = detectInteractiveLoginEvidence({
        qrcode: 'sensitive-qr-value',
        pairing_code: 'sensitive-pairing-value',
        passkey_public_key: 'sensitive-passkey-value',
        qr_pending: true,
        code: 208,
        connection_status: { status: 'qr', qrAvailable: true },
      });
      assert.deepEqual(evidence, [
        'awaiting_passkey_confirmation',
        'pairing_code',
        'passkey',
        'qr_credential',
        'qr_pending',
        'qr_status',
      ]);
      assert.equal(JSON.stringify(evidence).includes('sensitive'), false);
      assert.deepEqual(
        detectInteractiveLoginEvidence({
          connection_status: {
            pairing_code: 'nested-sensitive-pairing',
            status: 'pairing_in_progress',
          },
        }),
        ['pairing_code', 'pairing_status'],
      );
    `);
  });

  it('requires a strictly advanced, bounded and non-interactive durable window', () => {
    runCanaryModuleTest(`
      const healthy = {
        after_order: '40',
        observed_through_order: '44',
        first_window_order: '41',
        last_window_order: '44',
        window_event_count: 4,
        correlated_event_count: 2,
        window_truncated: false,
        interactive_login_detected: false,
        interactive_login_event_count: 0,
        qr_event_count: 0,
        pairing_event_count: 0,
        passkey_event_count: 0,
      };
      assert.doesNotThrow(() => assertDurableHandoffEvidence(healthy, '40'));
      assert.throws(
        () => assertDurableHandoffEvidence(
          { ...healthy, qr_event_count: 1 },
          '40',
        ),
        /interactive login evidence/,
      );
      assert.throws(
        () => assertDurableHandoffEvidence(
          { ...healthy, window_truncated: true },
          '40',
        ),
        /safety limit/,
      );
      assert.throws(
        () => assertDurableHandoffEvidence(
          { ...healthy, observed_through_order: '40' },
          '40',
        ),
        /did not advance/,
      );
      assert.throws(
        () => assertDurableHandoffEvidence(
          { ...healthy, correlated_event_count: 0 },
          '40',
        ),
        /no event correlated/,
      );
    `);
  });
});
