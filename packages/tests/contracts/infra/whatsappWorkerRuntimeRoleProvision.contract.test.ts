import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const composePath = path.resolve(workspaceRoot, 'docker-compose.yml');
const envExamplePath = path.resolve(workspaceRoot, '.env.example');
const migrationPath = path.resolve(
  workspaceRoot,
  'atlas/prod/20260802144500.sql'
);
const profileAnchorMigrationPath = path.resolve(
  workspaceRoot,
  'atlas/prod/20260809100000.sql'
);
const provisionPath = path.resolve(
  workspaceRoot,
  'infra/postgres/provision-whatsapp-worker-runtime-role.sh'
);

describe('WhatsApp worker PostgreSQL runtime role provisioning', () => {
  const compose = fs.readFileSync(composePath, 'utf8');
  const envExample = fs.readFileSync(envExamplePath, 'utf8');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const profileAnchorMigration = fs.readFileSync(
    profileAnchorMigrationPath,
    'utf8'
  );
  const provision = fs.readFileSync(provisionPath, 'utf8');

  it('keeps the provisioning script syntactically valid and secret-safe', () => {
    expect(() =>
      execFileSync('sh', ['-n', provisionPath], { stdio: 'pipe' })
    ).not.toThrow();
    expect(provision).toContain(
      '\\getenv runtime_password WHATSAPP_WORKER_RUNTIME_PASSWORD'
    );
    expect(provision).toContain("format('GRANT %I TO %I'");
    expect(provision).toContain('PASSWORD %L');
    expect(provision).not.toContain('PASSWORD ${');
    expect(provision).not.toContain('${DB_PASSWORD');
    expect(provision).toContain(
      'WORKER_DB_USER must differ from the provisioning database user'
    );
    expect(provision).toContain(
      'WORKER_DB_PASSWORD must differ from the provisioning password'
    );
    expect(provision).toContain("current_user = :'runtime_user'");
    expect(provision).toContain(
      'runtime_cluster_isolated="${WORKER_DB_CLUSTER_ISOLATED-}"'
    );
    expect(provision).toContain(
      'WORKER_DB_CLUSTER_ISOLATED=true is required after verifying a dedicated cluster or pg_hba database isolation'
    );
    expect(provision).toContain(
      "RAISE EXCEPTION 'worker runtime role provisioning aborted'"
    );
    expect(provision).not.toContain('\\quit 1');
  });

  it('enforces a restricted LOGIN under the dedicated NOLOGIN group', () => {
    expect(provision).toContain("runtime_group='whatsapp_session_runtime'");
    expect(provision).toContain(
      'runtime_user="${WORKER_DB_USER:-whatsapp_worker_runtime}"'
    );
    expect(provision).toContain('WITH NOLOGIN NOINHERIT NOSUPERUSER');
    expect(provision).toContain('WITH LOGIN INHERIT NOSUPERUSER');
    expect(provision).toContain(
      'NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
    );
    expect(provision).toContain("format('REVOKE %I FROM %I'");
    expect(provision).toContain('ALTER ROLE %I RESET ALL');
    expect(provision).toContain('ALTER ROLE %I IN DATABASE %I RESET ALL');
    expect(provision).toContain('pg_catalog.pg_db_role_setting');
    expect(provision).toContain('runtime_group_owns_objects');
    expect(provision).toContain(
      'whatsapp_session_runtime owns database objects; reassign ownership explicitly before provisioning'
    );
    expect(provision).toContain(
      "format('ALTER ROLE %I NOLOGIN', member_role.rolname)"
    );
    expect(provision).toContain(
      "format('REVOKE %I FROM %I', :'runtime_group', member_role.rolname)"
    );
    expect(provision).toContain('runtime_group_membership_invalid');
    expect(provision).toContain(
      'whatsapp_session_runtime must have exactly one non-admin member'
    );
    expect(provision).toContain(
      'WORKER_DB_USER owns database objects; reassign ownership explicitly before provisioning'
    );
  });

  it('removes direct ACL exploits from a pre-existing login before membership is restored', () => {
    const revokeTables = provision.indexOf(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I'
    );
    const revokeSequences = provision.indexOf(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I'
    );
    const revokeFunctions = provision.indexOf(
      'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I'
    );
    const grantMembership = provision.lastIndexOf("format('GRANT %I TO %I'");
    expect(revokeTables).toBeGreaterThan(0);
    expect(revokeSequences).toBeGreaterThan(revokeTables);
    expect(revokeFunctions).toBeGreaterThan(revokeSequences);
    expect(grantMembership).toBeGreaterThan(revokeFunctions);
    expect(provision).toContain(
      'WORKER_DB_USER retained a direct table/sequence/function/schema/database ACL'
    );
    expect(provision).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    expect(provision).toContain(
      "has_schema_privilege('public', 'public', 'CREATE')"
    );
    expect(provision).toContain("acl.privilege_type <> 'CONNECT'");
    expect(provision).toContain('pg_catalog.acldefault(\'d\'::"char"');
    expect(provision).toContain('pg_catalog.pg_shdepend');
    expect(provision).toContain("dependency.deptype IN ('a', 'o')");
    expect(provision).toContain(
      'WORKER_DB_USER retains ownership or a direct ACL outside the audited database allowlist'
    );
    expect(provision).not.toContain(
      'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC'
    );
  });

  it('wires local Compose to fail closed and wait for role provisioning', () => {
    expect(compose).toContain('under-db-whatsapp-worker-role-provision:');
    expect(compose).toContain(
      "WORKER_DB_PASSWORD: '${WORKER_DB_PASSWORD:?WORKER_DB_PASSWORD is required}'"
    );
    expect(compose).toContain(
      "WORKER_DB_USER: '${WORKER_DB_USER:-whatsapp_worker_runtime}'"
    );
    expect(compose).toContain(
      "WORKER_DB_CLUSTER_ISOLATED: '${WORKER_DB_CLUSTER_ISOLATED:?set true only for a dedicated cluster or pg_hba database isolation}'"
    );
    expect(compose).toContain('condition: service_completed_successfully');
    expect(compose).toContain('condition: service_healthy');
  });

  it('documents independent local worker credentials', () => {
    expect(envExample).toContain('WORKER_DB_USER=whatsapp_worker_runtime');
    expect(envExample).toContain('WORKER_DB_PASSWORD=change-me-worker-runtime');
    expect(envExample).toContain('WORKER_DB_CLUSTER_ISOLATED=true');
    expect(envExample).toContain('pg_hba');
    expect(envExample).toContain('Nao reutilize DB_USER/DB_PASSWORD');
  });

  it('keeps the audited operational grants closed and explicit', () => {
    const grantStart = migration.indexOf(
      '-- The same worker connection carries capability-fenced runtime status'
    );
    const grantEnd = migration.indexOf(
      'GRANT EXECUTE ON FUNCTION public.acquire_whatsapp_session_lease',
      grantStart
    );
    expect(grantStart).toBeGreaterThan(0);
    expect(grantEnd).toBeGreaterThan(grantStart);
    const grants = migration.slice(grantStart, grantEnd);

    for (const table of [
      'account',
      'worker',
      'worker_runtime',
      'worker_config',
      'chatbot',
      'message_template',
      'message_template_channel',
      'message_status',
      'account_plan_product_entitlement_revision',
      'plan',
      'plan_account',
      'plan_cross_sell',
      'plan_cross_sell_account',
      'plan_items',
      'outbound_webhook',
      'outbound_webhook_subscription',
      'outbound_webhook_event',
      'outbound_webhook_delivery',
    ]) {
      expect(grants).toContain(`public.${table}`);
    }

    expect(grants).toContain('GRANT INSERT, UPDATE ON TABLE');
    expect(grants).toContain('GRANT INSERT (');
    expect(grants).toContain('GRANT UPDATE (');
    expect(grants).not.toMatch(
      /GRANT INSERT, UPDATE ON TABLE\s+public\.account_plan_product_entitlement_revision/u
    );
    expect(grants).not.toContain('public.account_payment_cross_sell');
    expect(grants).not.toContain('public.s3_backup_upload');
    expect(grants).not.toContain('GRANT ALL');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.register_whatsapp_worker_s3_backup('
    );
    expect(migration).toContain(
      'ALTER TABLE public.s3_backup_upload ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public'
    );
  });

  it('keeps WWebJS profile authority SELECT-only behind signed scope and CAS', () => {
    expect(profileAnchorMigration).toContain(
      'REVOKE ALL ON TABLE public.whatsapp_wwebjs_profile_anchor\n  FROM whatsapp_session_runtime'
    );
    expect(profileAnchorMigration).toContain(
      'GRANT SELECT ON TABLE public.whatsapp_wwebjs_profile_anchor\n  TO whatsapp_session_runtime'
    );
    expect(profileAnchorMigration).not.toMatch(
      /GRANT (?:INSERT|UPDATE|DELETE)[\s\S]{0,120}whatsapp_wwebjs_profile_anchor/u
    );
    expect(profileAnchorMigration).toContain(
      'CREATE POLICY whatsapp_wwebjs_profile_anchor_runtime_select'
    );
    expect(profileAnchorMigration).toContain(
      'AND (SELECT public.whatsapp_runtime_scope_is_valid())'
    );
    expect(profileAnchorMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v1('
    );
    expect(profileAnchorMigration).toContain(
      'profile-anchor-canonical-checkpoint-v1'
    );
  });
});
