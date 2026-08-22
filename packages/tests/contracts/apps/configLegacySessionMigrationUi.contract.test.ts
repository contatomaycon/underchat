import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

const configChannels = read('apps/web/src/pages/config/channels-tab.vue');
const ordinaryChannels = read('apps/web/src/pages/channels.vue');
const dialog = read(
  'apps/web/src/components/channel/LegacySessionMigrationDialog.vue'
);
const editor = read('apps/web/src/components/channel/AppEditConfigChannel.vue');
const frontendLocales = ['pt', 'en', 'es'].map((locale) => ({
  locale,
  messages: JSON.parse(
    read(`apps/web/src/plugins/i18n/locales/${locale}.json`)
  ) as Record<string, unknown>,
}));

const migrationTranslationKeys = [
  'attempt',
  'authenticated',
  'close_and_follow_later',
  'delete_legacy_volume',
  'destination',
  'elapsed',
  'follow_migration',
  'keep_for_now',
  'legacy_session_editor_migration_required',
  'limit',
  'migrate_session',
  'origin',
  'provider',
  'real_time_status',
  'session_migration_cleanup_manual_warning',
  'session_migration_close_safe',
  'session_migration_confirm_description',
  'session_migration_confirm_title',
  'session_migration_ingress_ready',
  'session_migration_non_cancelable_warning',
  'session_migration_phase_capturing',
  'session_migration_phase_cleanup_pending',
  'session_migration_phase_completed',
  'session_migration_phase_cutting_over',
  'session_migration_phase_deleting_volume',
  'session_migration_phase_queued',
  'session_migration_phase_recovery_required',
  'session_migration_phase_restored',
  'session_migration_phase_restoring',
  'session_migration_phase_retry_wait',
  'session_migration_phase_staged',
  'session_migration_phase_starting',
  'session_migration_phase_validating',
  'session_migration_progress_description',
  'session_migration_progress_title',
  'session_migration_recovery_required_description',
  'session_migration_recovery_required_title',
  'session_migration_recovery_required_warning',
  'session_migration_restored_description',
  'session_migration_restored_title',
  'session_migration_revision_active',
  'session_migration_secure_in_progress',
  'session_migration_send_receive_ready',
  'session_migration_source_preserved',
  'session_migration_start_error',
  'session_migration_success_description',
  'session_migration_success_title',
  'session_migration_volume_absence_confirmed',
  'session_migration_volume_delete_error',
  'session_migration_volume_deleted',
] as const;

describe('Config-only legacy session migration UI', () => {
  it('offers migrate/follow/cleanup only from the Config channels table', () => {
    expect(configChannels).toContain('migrationAction(item)');
    expect(configChannels).toContain('EWorkerSessionStorage.legacy_volume');
    expect(configChannels).toContain('supportsWhatsappSessionStorage');
    expect(configChannels).toContain('follow_migration');
    expect(configChannels).toContain('delete_legacy_volume');
    expect(ordinaryChannels).not.toContain('LegacySessionMigrationDialog');
    expect(ordinaryChannels).not.toContain('startSessionStorageMigration');
  });

  it('shows a non-cancelable three-attempt flow while allowing the modal to close', () => {
    expect(dialog).toContain('session_migration_non_cancelable_warning');
    expect(dialog).toContain('migration.attempt_count }} / 3');
    expect(dialog).toContain('05:00');
    expect(dialog).toContain('close_and_follow_later');
    expect(dialog).not.toContain('cancel-migration');
    expect(dialog).toContain("props.migration?.state === 'recovery_required'");
    expect(dialog).toContain('session_migration_recovery_required_warning');
  });

  it('uses the standard dialog close control and project corner radius', () => {
    expect(dialog).toContain('<DialogCloseBtn');
    expect(dialog).not.toContain('legacy-migration__close');
    expect(dialog).not.toContain('border-radius: 28px');
    expect(dialog).toContain('border-radius: 8px');
    expect(configChannels.match(/standard-appearance/g)).toHaveLength(5);
  });

  it.each(frontendLocales)(
    'defines every migration key in the $locale frontend catalog',
    ({ messages }) => {
      for (const key of migrationTranslationKeys) {
        expect(messages[key]).toEqual(expect.any(String));
        expect(messages[key]).not.toBe(key);
      }
    }
  );

  it('blocks ordinary routing edits for a legacy volume', () => {
    expect(editor).toContain('isLegacySession');
    expect(editor).toContain('legacy_session_editor_migration_required');
    expect(editor).toContain(':disabled="isLegacySession"');
  });
});
