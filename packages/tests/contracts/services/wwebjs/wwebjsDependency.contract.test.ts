import fs from 'node:fs';
import path from 'node:path';

import whatsappWeb, { type Client } from '@wwebjs/whatsapp-web.js';

const wwebjsPackageRoot = path.dirname(
  require.resolve('@wwebjs/whatsapp-web.js')
);
const postgresSessionStoreSource = fs.readFileSync(
  path.join(wwebjsPackageRoot, 'src', 'session', 'PostgresSessionStore.js'),
  'utf8'
);
const browserSessionBridgeSource = fs.readFileSync(
  path.join(wwebjsPackageRoot, 'src', 'session', 'BrowserSessionBridge.js'),
  'utf8'
);
const remoteAuthSource = fs.readFileSync(
  path.join(wwebjsPackageRoot, 'src', 'authStrategies', 'RemoteAuth.js'),
  'utf8'
);
const clientSource = fs.readFileSync(
  path.join(wwebjsPackageRoot, 'src', 'Client.js'),
  'utf8'
);
const canonicalSessionBridgeSource = fs.readFileSync(
  path.join(wwebjsPackageRoot, 'src', 'session', 'CanonicalSessionBridge.js'),
  'utf8'
);
const canonicalBridgeImportSpecifier =
  '@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js';
const connectionServiceSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'packages',
    'services',
    'wwebjs',
    'methods',
    'connection.service.ts'
  ),
  'utf8'
);
const postgresSessionStoreIntegrationSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'packages',
    'services',
    'wwebjs',
    'methods',
    'postgresSessionStore.ts'
  ),
  'utf8'
);
const workerDockerfileSource = fs.readFileSync(
  path.join(process.cwd(), 'apps', 'worker_wwebjs', 'Dockerfile'),
  'utf8'
);

type WwebjsPublicEventGateClient = Client & {
  _beginPublicEventGate: () => void;
  _releasePublicEventGate: () => number;
  _discardPublicEventGate: (options?: { block?: boolean }) => void;
  _publishAuthenticationReady: (payload: object) => void;
  _publicEventsBlocked: boolean;
};

const createClient = (): WwebjsPublicEventGateClient =>
  new whatsappWeb.Client({
    authStrategy: {
      setup: () => undefined,
      validateClientOptions: () => undefined,
      destroy: async () => undefined,
    },
  } as never) as WwebjsPublicEventGateClient;

describe('WWebJS real dependency contract', () => {
  it('uses a Node ESM-resolvable canonical bridge specifier in runtime code', async () => {
    expect(connectionServiceSource).toContain(canonicalBridgeImportSpecifier);
    expect(postgresSessionStoreIntegrationSource).toContain(
      canonicalBridgeImportSpecifier
    );
    expect(workerDockerfileSource).toContain(
      `await import('${canonicalBridgeImportSpecifier}')`
    );

    const bridge = await import(canonicalBridgeImportSpecifier);
    expect(typeof bridge.normalizeCanonicalProjection).toBe('function');
  });

  it('pins the fork release preserving fenced pairing across navigation', () => {
    expect(
      (whatsappWeb as typeof whatsappWeb & { version: string }).version
    ).toBe('1.34.150');
    expect(browserSessionBridgeSource).toContain(
      "'secure_import_browser_bootstrap'"
    );
    expect(postgresSessionStoreSource).toContain('secureImportRollbackContext');
    expect(postgresSessionStoreSource).toContain(
      'secureImportBrowserBootstrap'
    );
    expect(postgresSessionStoreSource).toContain(
      'this.lifecycleOperationId === this.handoffId'
    );
    expect(postgresSessionStoreSource).toContain(
      "this.secureImportRollbackContext?.source === 'pairing'"
    );
    expect(postgresSessionStoreSource).not.toContain(
      'whatsapp_session_rollback_source_missing'
    );
    expect(browserSessionBridgeSource).toContain(
      'wwebjs_connected_profile_navigation_superseded'
    );
    expect(clientSource).toContain(
      "'wwebjs_connected_profile_navigation_superseded'"
    );
    expect(remoteAuthSource).toContain('nativeInitialPairingReadyRuntimeEpoch');
    expect(remoteAuthSource).toContain(
      'isInitialPairingReadyNavigationSuccessorAllowed'
    );
    expect(remoteAuthSource).toContain(
      "this.store.revisionStatus === 'staging'"
    );
    expect(remoteAuthSource).toContain(
      "this.store.revisionSource === 'pairing'"
    );
    expect(postgresSessionStoreSource).toContain(
      'CONNECTED_PROFILE_NAVIGATION_SUPERSEDED'
    );
    expect(postgresSessionStoreSource).toContain(
      "String(error?.code || '') ==="
    );
    expect(postgresSessionStoreSource).toContain(
      "'checkpoint.navigation_superseded'"
    );
    expect(postgresSessionStoreSource).toContain(
      '!nonDestructiveCheckpointRace'
    );
    expect(remoteAuthSource).toContain('checkpointReadyNavigationSuccessor');
    expect(browserSessionBridgeSource).toContain(
      'derivedMaterialCleanupAttempted'
    );
    expect(browserSessionBridgeSource).toContain(
      'derived_material_cleanup_stable_samples'
    );
    expect(browserSessionBridgeSource).toContain(
      'browser_bridge.adv_secret_capture_unchanged'
    );
    expect(browserSessionBridgeSource).toContain(
      'restoreWindowIsEmpty(firstDerivedCleanupWindow)'
    );
    expect(browserSessionBridgeSource).toContain(
      'exactSyncKeyMaterialMatches(persisted)'
    );
    expect(browserSessionBridgeSource).toContain(
      'canonicalSocketLogoutBootstrapGraceMs = 5000'
    );
    expect(browserSessionBridgeSource).toContain(
      'canonicalSocketLogoutBootstrapSuppressionCount === 0'
    );
    expect(remoteAuthSource).toContain('legacyVolumeMigrationBootstrap');
    expect(remoteAuthSource).toContain(
      'waitForInitialCanonicalAppStateStability'
    );
    expect(browserSessionBridgeSource).toContain(
      'CANONICAL_LEGACY_PROFILE_TRANSIENT_BLOCKERS'
    );
    expect(browserSessionBridgeSource).toContain(
      'allowLegacyProfileTransientProjection'
    );
    expect(browserSessionBridgeSource).toContain(
      'CANONICAL_INITIAL_APP_STATE_BROWSER_OPERATION_TIMEOUT_MS = 30000'
    );
    expect(browserSessionBridgeSource).toContain(
      'wwebjs_canonical_initial_app_state_browser_operation_timeout'
    );
    expect(browserSessionBridgeSource).toContain(
      "entry === 'module_abi.incompatible'"
    );
    expect(remoteAuthSource).toContain(
      'allowLegacyProfileTransientProjection:'
    );
    expect(postgresSessionStoreSource).toContain(
      "['pairing', 'legacy_volume_migration']"
    );
    expect(postgresSessionStoreSource).toContain(
      'promote_legacy_volume_migration_revision'
    );
    expect(postgresSessionStoreSource).toContain(
      'session.state AS session_state'
    );
    expect(postgresSessionStoreSource).toContain(
      "context.session_state === 'handoff'"
    );
    expect(postgresSessionStoreSource).toContain(
      'normalizeCanonicalAuthoritativeAppStateForPortablePersistence'
    );
    expect(postgresSessionStoreSource).toContain(
      'canonicalProjectionHasFutureMutationMac'
    );
    expect(postgresSessionStoreSource).toContain(
      'secure_import.browser_canonical_app_state_normalized'
    );
    expect(postgresSessionStoreSource).toContain(
      'String(context.active_revision_id) ==='
    );
    expect(clientSource).toContain(
      'client.authentication_navigation_superseded'
    );
    expect(clientSource).toContain(
      'client.initialization_navigation_recovery_joined'
    );
    expect(clientSource).toContain(
      'client.authentication_publication_superseded'
    );
    expect(clientSource).toContain('_authReadyInFlightDocumentEpoch');
    expect(remoteAuthSource).toContain(
      'session.identity_validation_navigation_superseded'
    );
    expect(remoteAuthSource).toContain('legacyVolumeMigrationBootstrap &&');
    expect(remoteAuthSource).toContain('connectedProfileSnapshot: true');
    expect(remoteAuthSource).toContain(
      'wwebjs_connected_profile_checkpoint_scope_invalid'
    );
    expect(remoteAuthSource).toContain(
      "['pairing', 'legacy_volume_migration'].includes"
    );
    expect(browserSessionBridgeSource).toContain(
      'freezeConnectedProfileSnapshot'
    );
    expect(browserSessionBridgeSource).toContain(
      'resumeConnectedProfileSnapshot'
    );
    expect(browserSessionBridgeSource).toContain(
      'browser_bridge.connected_profile_resumed'
    );
    expect(clientSource).toContain('_ensureWWebJSUtilitiesAfterAuthReady(');
    expect(clientSource).toContain('client.ready_utility_reinjection_started');
    expect(clientSource).toContain('wwebjs_ready_utility_document_replaced');
    expect(clientSource).toContain(
      'wwebjs_ready_utility_navigation_superseded'
    );
    expect(clientSource).toContain('TRANSIENT_NAVIGATION_ERROR_CODES');
    expect(clientSource).toContain(
      'expectedNavigationSequence = this._mainFrameNavigationSequence'
    );
    expect(clientSource).toContain(
      'storeAvailable || this._authReadyPublished !== true'
    );
    expect(clientSource).toContain('wwebjs_ready_event_bridge_missing');
    expect(clientSource).toContain(
      'wwebjs_ready_utility_reinjection_incomplete'
    );
    expect(clientSource).toContain(
      "typeof window.WWebJS.getMessageModel === 'function'"
    );
    expect(clientSource).toContain(
      "typeof window.WWebJS.getChat === 'function'"
    );
    expect(clientSource).toContain(
      "typeof window.WWebJS.normalizeMessageId === 'function'"
    );
  });

  it('treats an explicit live Web cache policy as a complete opt-out', () => {
    const client = new whatsappWeb.Client({
      authStrategy: {
        setup: () => undefined,
        validateClientOptions: () => undefined,
        destroy: async () => undefined,
      },
      webVersionCache: { type: 'none' },
    } as never) as unknown as {
      options: { webVersionCache: Record<string, unknown> };
      assertPinnedWebVersion: (actualVersion: string) => void;
    };

    expect(client.options.webVersionCache).toEqual({ type: 'none' });
    expect(() =>
      client.assertPinnedWebVersion('2.3000.9999999999')
    ).not.toThrow();
  });

  it('keeps recreate transport reconciliation bounded and fail-closed', () => {
    expect(browserSessionBridgeSource).toContain(
      'CANONICAL_APP_STATE_RESTORE_TRANSPORT_GRACE_MS = 5000'
    );
    expect(browserSessionBridgeSource).toContain(
      'browser_bridge.app_state_restore_transport_reconciling'
    );
    expect(browserSessionBridgeSource).toContain(
      'wwebjs_canonical_app_state_restore_barrier_not_connected'
    );
  });

  it('preserves only independently equivalent Signal components during a reusable handoff', () => {
    const postgresSessionStorePrototype = whatsappWeb.PostgresSessionStore
      .prototype as unknown as {
      getReusableHandoffProfileSignalTableEquivalence: unknown;
    };

    expect(
      typeof postgresSessionStorePrototype.getReusableHandoffProfileSignalTableEquivalence
    ).toBe('function');
    expect(canonicalSessionBridgeSource).toContain(
      'selective_component_replace'
    );
    expect(canonicalSessionBridgeSource).toContain(
      'preserved_signal_components'
    );
    expect(canonicalSessionBridgeSource).toContain(
      'preserved_pre_key_validation'
    );
  });

  it('trusts the activation stored procedure as the atomic quarantine authority', () => {
    const activationCommit =
      whatsappWeb.PostgresSessionStore.prototype.commitActivation.toString();

    expect(activationCommit).toContain('commit_whatsapp_session_activation');
    expect(activationCommit).not.toContain(
      'assertPostActivationQuarantineInTransaction'
    );
  });

  it('accepts only a proven empty classical Baileys projection when the WWeb runtime has no Kyber tables', () => {
    expect(postgresSessionStoreSource).toContain(
      'baileysClassicalPostQuantumRollbackAcknowledged'
    );
    expect(postgresSessionStoreSource).toContain(
      'whatsapp_session_handoff_pq_rollback_state_invalid'
    );
    expect(postgresSessionStoreSource).toContain('snapshot.pqPreKeyState = []');
  });

  it('finishes durable logout when WhatsApp navigation destroys the page context', async () => {
    const calls: string[] = [];
    let browserConnected = true;
    const client = new whatsappWeb.Client({
      authStrategy: {
        setup: () => undefined,
        validateClientOptions: () => undefined,
        destroy: async () => undefined,
        logout: async () => {
          calls.push('auth-logout');
        },
      },
    } as never);
    const clientRuntime = client as unknown as {
      pupPage: { evaluate: () => Promise<never> };
      pupBrowser: {
        process: () => object;
        close: () => Promise<void>;
        isConnected: () => boolean;
      };
    };
    clientRuntime.pupPage = {
      evaluate: async () => {
        calls.push('socket-logout');
        throw new Error('Execution context was destroyed');
      },
    };
    clientRuntime.pupBrowser = {
      process: () => ({}),
      close: async () => {
        calls.push('browser-close');
        browserConnected = false;
      },
      isConnected: () => browserConnected,
    };

    await expect(client.logout()).resolves.toBeUndefined();
    expect(calls).toEqual(['socket-logout', 'browser-close', 'auth-logout']);
  });

  it('does not delete durable auth while Chromium termination is unconfirmed', async () => {
    const authLogout = jest.fn(async () => undefined);
    const client = new whatsappWeb.Client({
      authStrategy: {
        setup: () => undefined,
        validateClientOptions: () => undefined,
        destroy: async () => undefined,
        logout: authLogout,
      },
    } as never);
    const clientRuntime = client as unknown as {
      pupPage: { evaluate: () => Promise<never> };
      pupBrowser: {
        process: () => object;
        close: () => Promise<never>;
        isConnected: () => boolean;
      };
    };
    clientRuntime.pupPage = {
      evaluate: async () => {
        throw new Error('Execution context was destroyed');
      },
    };
    clientRuntime.pupBrowser = {
      process: () => ({}),
      close: async () => {
        throw new Error('browser-close-failed');
      },
      isConnected: () => true,
    };

    await expect(client.logout()).rejects.toThrow('Unable to log out cleanly.');
    expect(authLogout).not.toHaveBeenCalled();
  });

  it('reads the active profile anchor without requesting runtime UPDATE privilege', () => {
    const storePrototype = whatsappWeb.PostgresSessionStore
      .prototype as unknown as {
      loadActiveProfileAnchorInTransaction: () => unknown;
    };
    const anchorRead =
      storePrototype.loadActiveProfileAnchorInTransaction.toString();

    expect(anchorRead).toContain('FROM whatsapp_wwebjs_profile_anchor');
    expect(anchorRead).not.toContain('FOR UPDATE OF anchor');
  });

  it('treats optional zero app-state timestamps as unknown without weakening target lineage checks', () => {
    expect(postgresSessionStoreSource).toContain('lastKnownTimestamp');
    expect(postgresSessionStoreSource).toContain('current.timestamp > 0');
    expect(postgresSessionStoreSource).toContain('sourceTimestampAnchor');
    expect(postgresSessionStoreSource).toContain('targetEntry.timestamp > 0');
  });

  it('authorizes outbound handoffs without reading the RLS-hidden target revision', () => {
    const handoffAuthorizationSource =
      whatsappWeb.PostgresSessionStore.prototype.assertAuthorizedHandoff.toString();

    expect(handoffAuthorizationSource).toContain(
      'JOIN whatsapp_session_revision source'
    );
    expect(handoffAuthorizationSource).toContain(
      'handoff.target_revision_id IS NOT NULL'
    );
    expect(handoffAuthorizationSource).toContain(
      'handoff.target_revision_id <>'
    );
    expect(handoffAuthorizationSource).toContain(
      'handoff.lifecycle_operation_id IS NOT NULL'
    );
    expect(handoffAuthorizationSource).toContain(
      'FOR SHARE OF session, source'
    );
    expect(handoffAuthorizationSource).not.toContain(
      'JOIN whatsapp_session_revision target'
    );
    expect(handoffAuthorizationSource).not.toMatch(
      /FOR SHARE OF[\s\S]*\bhandoff\b/u
    );
  });

  it('coalesces the gated checkpoint and publishes it before authenticated and ready', () => {
    const client = createClient();
    const events: string[] = [];
    const durableClients = new WeakSet<object>();
    let readyObservedCheckpoint = false;

    client.on(whatsappWeb.Events.REMOTE_SESSION_SAVED, () => {
      durableClients.add(client);
      events.push('remote_session_saved');
    });
    client.on(whatsappWeb.Events.AUTHENTICATED, () => {
      events.push('authenticated');
    });
    client.on(whatsappWeb.Events.READY, () => {
      readyObservedCheckpoint = durableClients.has(client);
      events.push('ready');
    });

    client._beginPublicEventGate();
    client.emit(whatsappWeb.Events.REMOTE_SESSION_SAVED);
    client.emit(whatsappWeb.Events.REMOTE_SESSION_SAVED);
    expect(events).toEqual([]);

    expect(client._releasePublicEventGate()).toBe(2);
    client._publishAuthenticationReady({});

    expect(events).toEqual(['remote_session_saved', 'authenticated', 'ready']);
    expect(readyObservedCheckpoint).toBe(true);
  });

  it.each(['before release', 'after release'] as const)(
    'does not replay a checkpoint discarded %s',
    (discardStage) => {
      const client = createClient();
      const events: string[] = [];
      client.on(whatsappWeb.Events.REMOTE_SESSION_SAVED, () => {
        events.push('remote_session_saved');
      });

      client._beginPublicEventGate();
      client.emit(whatsappWeb.Events.REMOTE_SESSION_SAVED);
      if (discardStage === 'after release') {
        client._releasePublicEventGate();
      }
      client._discardPublicEventGate({ block: true });
      client._publicEventsBlocked = false;
      client._publishAuthenticationReady({});

      expect(events).toEqual([]);
    }
  );
});
