import fs from 'node:fs';
import path from 'node:path';

const baileysPackageRoot = path.resolve(
  path.dirname(require.resolve('@whiskeysockets/baileys')),
  '..'
);
const baileysPackage = JSON.parse(
  fs.readFileSync(path.join(baileysPackageRoot, 'package.json'), 'utf8')
) as { version?: unknown };
const postgresAuthStateSource = fs.readFileSync(
  path.join(baileysPackageRoot, 'lib', 'Utils', 'use-postgres-auth-state.js'),
  'utf8'
);
const multiFileAuthStateSource = fs.readFileSync(
  path.join(baileysPackageRoot, 'lib', 'Utils', 'use-multi-file-auth-state.js'),
  'utf8'
);
const sessionImportSource = fs.readFileSync(
  path.join(
    baileysPackageRoot,
    'lib',
    'Utils',
    'import-whatsapp-web-session.js'
  ),
  'utf8'
);
const chatsSocketSource = fs.readFileSync(
  path.join(baileysPackageRoot, 'lib', 'Socket', 'chats.js'),
  'utf8'
);
const genericsSource = fs.readFileSync(
  path.join(baileysPackageRoot, 'lib', 'Utils', 'generics.js'),
  'utf8'
);
const waBinaryGenericUtilsSource = fs.readFileSync(
  path.join(baileysPackageRoot, 'lib', 'WABinary', 'generic-utils.js'),
  'utf8'
);

describe('Baileys real dependency contract', () => {
  it('pins the expected internal fork release', () => {
    expect(baileysPackage.version).toBe('1.0.43');
  });

  it('reseals staged imports only after alias and fingerprint continuity', () => {
    expect(postgresAuthStateSource).toContain('expectedLid');
    expect(postgresAuthStateSource).toContain('expectedDeviceFingerprint');
    expect(postgresAuthStateSource).toContain('expectedAliases');
    expect(postgresAuthStateSource).toContain('finalAliases');
    expect(postgresAuthStateSource).toContain(
      'Baileys staged import changed every companion identity alias before promotion'
    );
    expect(postgresAuthStateSource).toContain(
      'Baileys staged import changed its companion fingerprint before promotion'
    );
    expect(postgresAuthStateSource).toContain('promoteSealedCandidate');
    expect(postgresAuthStateSource).toContain(
      'const durableCreds = await this.loadCreds()'
    );
    expect(postgresAuthStateSource).toMatch(
      /assertStagedImportIdentityContinuity\(stagedImport, sealed\.device\)[\s\S]*assertExpectedPromotionIdentity\(expectedJid, sealed\.device\)[\s\S]*commitPromotion\(previousRevisionId\)/u
    );
    expect(postgresAuthStateSource).toMatch(
      /if \(this\.handoffTarget\)[\s\S]*promoteSealedCandidate\(target\.sourceRevisionId\)/u
    );
    expect(postgresAuthStateSource).not.toContain(
      'commitPromotion(candidate.previousActiveRevisionId'
    );
    expect(postgresAuthStateSource).not.toContain(
      'this.promote(candidate.previousActiveRevisionId, candidate.expectedJid)'
    );
    const promotionSql = postgresAuthStateSource.match(
      /SELECT public\.promote_whatsapp_session_revision\(([\s\S]*?)\) AS promoted/u
    )?.[1];
    expect(promotionSql).toContain('$8');
    expect(promotionSql).not.toContain('$9');
    expect(postgresAuthStateSource).toContain(
      'candidate_identity_incomplete_or_mismatched'
    );
    expect(postgresAuthStateSource).toContain('candidate_identity_changed');
  });

  it('exposes valid stanza codes through the canonical Boom status', () => {
    expect(waBinaryGenericUtilsSource).toContain(
      'Number.isInteger(parsedCode) && parsedCode >= 400 && parsedCode <= 599'
    );
    expect(waBinaryGenericUtilsSource).toMatch(
      /new Boom[\s\S]*statusCode,[\s\S]*data: parsedCode/u
    );
  });

  it('keeps media ack stream failures recoverable without weakening explicit bad-session codes', () => {
    expect(genericsSource).toContain('ack: DisconnectReason.connectionLost');
    expect(genericsSource).toContain(
      'node.attrs.code || CODE_MAP[reason] || DisconnectReason.badSession'
    );
  });

  it('hydrates the exact legacy migration scaffold instead of creating an empty-source handoff', () => {
    expect(postgresAuthStateSource).toContain("header.state === 'preparing'");
    expect(postgresAuthStateSource).toContain(
      'asBigintString(header.active_revision_id) === previousRevisionId'
    );
    expect(postgresAuthStateSource).toContain(
      "this.revisionSource === 'legacy_volume_migration'"
    );
    expect(postgresAuthStateSource).toContain(
      'Boolean(this.storageMigrationId)'
    );
    expect(postgresAuthStateSource).toContain(
      'promote_legacy_volume_migration_revision'
    );
  });

  it('collapses only stale legacy LID projections using the reciprocal reverse entry', () => {
    expect(postgresAuthStateSource).toContain(
      'const canonicalRows = [...rowsByLid.entries()]'
    );
    expect(postgresAuthStateSource).toContain("entry.id.endsWith('_reverse')");
    expect(postgresAuthStateSource).toContain('candidate.pn === reversePn');
    expect(postgresAuthStateSource).toContain(
      'codec_ambiguous_baileys_lid_mapping'
    );
  });

  it('decodes only explicitly marked legacy multi-file storage packages', () => {
    expect(sessionImportSource).toContain('multi_file_auth_state_v1');
    expect(sessionImportSource).toContain(
      'baileys_import_invalid_legacy_sender_key_id'
    );
    expect(sessionImportSource).toContain(
      'baileys_import_invalid_legacy_app_state_key_id'
    );
    expect(sessionImportSource).toMatch(
      /'pq-last-resort-key',[\s\S]*'pq-pre-key-state',[\s\S]*'pq-pre-key'/u
    );
    expect(sessionImportSource).toContain(
      'proto.Message.AppStateSyncKeyData.fromObject'
    );
    expect(postgresAuthStateSource).toContain(
      'codec_active_receiver_chain_key_material_missing'
    );
  });

  it('rehydrates legacy-volume companion identity protobufs after restart', () => {
    expect(multiFileAuthStateSource).toContain(
      'normalizeAuthenticationCredentialBinaries'
    );
    expect(multiFileAuthStateSource).toMatch(
      /normalizeAuthenticationCredentialBinaries\([\s\S]*readData\('creds\.json'\)/u
    );
  });

  it('persists and hydrates canonical sender-only Signal states', () => {
    expect(postgresAuthStateSource).not.toContain(
      'codec_baileys_receiver_chain_missing'
    );
    expect(postgresAuthStateSource).toContain(
      'BAILEYS_MISSING_RECEIVER_RATCHET_KEY'
    );
    expect(postgresAuthStateSource).toMatch(
      /latestReceiver\s*\?\s*requiredCanonicalBuffer[\s\S]*BAILEYS_MISSING_RECEIVER_RATCHET_KEY/u
    );
  });

  it('requires a server-acknowledged classical PQ rollback for both cross-provider targets', () => {
    expect(postgresAuthStateSource).toContain(
      "targetProvider === 'wwebjs' || targetProvider === 'whatsmeow'"
    );
    expect(postgresAuthStateSource).toContain(
      "signalSessionScopes: ['default']"
    );
    expect(postgresAuthStateSource).toContain(
      "signalSessionResyncScopes: ['status', 'pq']"
    );
  });

  it('treats optional zero app-state timestamps as unknown while validating the complete target chain', () => {
    expect(postgresAuthStateSource).toContain('proof.timestamp === 0');
    expect(postgresAuthStateSource).toContain('lastKnownTimestamp');
    expect(postgresAuthStateSource).toContain(
      'summarizeAppStateSyncKeyProofs(targetProofs'
    );
    expect(postgresAuthStateSource).toContain('extra.timestamp > 0');
  });

  it('uses the five-column handoff source-read ABI and validates lifecycle lineage separately', () => {
    expect(postgresAuthStateSource).toMatch(
      /target_revision_id, handoff_id\s+FROM public\.begin_whatsapp_handoff_source_read/u
    );
    expect(postgresAuthStateSource).not.toMatch(
      /target_revision_id, handoff_id, lifecycle_operation_id\s+FROM public\.begin_whatsapp_handoff_source_read/u
    );
    expect(postgresAuthStateSource).toContain(
      'SELECT lifecycle_operation_id::text AS lifecycle_operation_id'
    );
    expect(postgresAuthStateSource).toContain(
      'AND source_revision_id=$3::bigint AND target_revision_id=$4::bigint'
    );
    expect(postgresAuthStateSource).toContain(
      "AND source_provider=$5 AND target_provider='baileys'"
    );
    expect(postgresAuthStateSource).toContain(
      'AND lifecycle_operation_id=$6::uuid'
    );
    expect(postgresAuthStateSource).toContain(
      'lineageResult.rows.length !== 1'
    );
  });

  it('normalizes inherited c.us companion JIDs independent of the immediate source provider', () => {
    expect(postgresAuthStateSource).toMatch(
      /if \(!value\.endsWith\('@c\.us'\)\)\s+return value/u
    );
    expect(postgresAuthStateSource).not.toContain(
      "sourceProvider !== 'wwebjs' || !value.endsWith('@c.us')"
    );
    expect(postgresAuthStateSource).toContain(
      '/^([1-9][0-9]*)(?::([1-9][0-9]*))?@c\\.us$/'
    );
    expect(postgresAuthStateSource).toContain(
      "jidEncode(decoded.user, 's.whatsapp.net', device)"
    );
    expect(postgresAuthStateSource).toContain(
      'const targetJid = converted.projection.jid'
    );
    expect(postgresAuthStateSource).toMatch(
      /this\.revisionId,\s+targetJid,\s+converted\.projection\.lid/u
    );
  });

  it('starts the signed WWebJS snapshot resync after native bootstrap is ready', () => {
    expect(postgresAuthStateSource).toContain(
      'getPendingAppStateSnapshotResyncCollections()'
    );
    expect(postgresAuthStateSource).toContain(
      'appStateSnapshotResyncCollections'
    );
    expect(chatsSocketSource).toContain(
      'authState.appStateSnapshotResyncCollections'
    );
    expect(chatsSocketSource).toContain(
      'resyncing handoff app state snapshots after authenticated bootstrap'
    );
    expect(chatsSocketSource).toContain(
      'HANDOFF_SNAPSHOT_RESYNC_QUERY_TIMEOUT_MS'
    );
    expect(chatsSocketSource).toMatch(
      /connection === ['"]open['"][\s\S]*scheduleHandoffSnapshotResyncFallback\(\)/u
    );
    expect(chatsSocketSource).toMatch(
      /receivedPendingNotifications[\s\S]*triggerHandoffSnapshotResync\(\)/u
    );
    expect(chatsSocketSource).toContain(
      'materialized server-confirmed empty app state collection'
    );
    expect(chatsSocketSource).toContain(
      'materialized server-omitted empty app state collection'
    );
    expect(chatsSocketSource).toContain(
      'shouldMaterializeOmittedAppStateCollection'
    );
    expect(chatsSocketSource).toContain('shouldStartHandoffSnapshotResync');
    expect(chatsSocketSource).toContain('receivedPendingNotifications');
    expect(chatsSocketSource).toContain('HANDOFF_SNAPSHOT_RESYNC_FALLBACK_MS');
    expect(chatsSocketSource).toContain('HANDOFF_SNAPSHOT_RESYNC_MAX_ATTEMPTS');
    expect(chatsSocketSource).toContain('buildAppStateCollectionAttrs');
    expect(chatsSocketSource).toMatch(
      /returnSnapshot \? \{\} : \{ version: input\.version\.toString\(\) \}/u
    );
    expect(chatsSocketSource).toContain('hasAuthoritativeAppStateSyncResponse');
    expect(chatsSocketSource).toContain(
      "code: 'APP_STATE_SYNC_RESPONSE_MISSING'"
    );
    expect(chatsSocketSource).toContain(
      "'app-state-sync-version': { [name]: states[name] }"
    );
  });

  it('defers authenticated handoff promotion to the protected provider CAS', () => {
    expect(postgresAuthStateSource).toContain(
      "this.revisionStatus === 'active' || this.stagedImport || this.handoffTarget"
    );
    expect(postgresAuthStateSource).toContain(
      'finalize_whatsapp_session_pairing'
    );
  });
});
