#!/bin/sh

set -eu

runtime_group='whatsapp_session_runtime'
runtime_user="${WORKER_DB_USER:-whatsapp_worker_runtime}"
runtime_password="${WORKER_DB_PASSWORD-}"
runtime_cluster_isolated="${WORKER_DB_CLUSTER_ISOLATED-}"

if [ -z "$runtime_user" ]; then
  echo 'WORKER_DB_USER must not be empty' >&2
  exit 1
fi

if [ -z "$runtime_password" ]; then
  echo 'WORKER_DB_PASSWORD is required and must not be empty' >&2
  exit 1
fi

if [ "$runtime_cluster_isolated" != 'true' ]; then
  echo 'WORKER_DB_CLUSTER_ISOLATED=true is required after verifying a dedicated cluster or pg_hba database isolation' >&2
  exit 1
fi

if [ "$runtime_user" = "$runtime_group" ]; then
  echo 'WORKER_DB_USER must differ from whatsapp_session_runtime' >&2
  exit 1
fi

if [ -n "${PGUSER-}" ] && [ "$runtime_user" = "$PGUSER" ]; then
  echo 'WORKER_DB_USER must differ from the provisioning database user' >&2
  exit 1
fi

if [ -n "${PGPASSWORD-}" ] && [ "$runtime_password" = "$PGPASSWORD" ]; then
  echo 'WORKER_DB_PASSWORD must differ from the provisioning password' >&2
  exit 1
fi

# \getenv keeps the password out of argv and out of generated shell/SQL text.
# PostgreSQL format(%I/%L) performs identifier/literal quoting, so role names
# and rotated passwords never become executable SQL fragments.
export WHATSAPP_SESSION_RUNTIME_GROUP="$runtime_group"
export WHATSAPP_WORKER_RUNTIME_USER="$runtime_user"
export WHATSAPP_WORKER_RUNTIME_PASSWORD="$runtime_password"

exec psql --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
\getenv runtime_group WHATSAPP_SESSION_RUNTIME_GROUP
\getenv runtime_user WHATSAPP_WORKER_RUNTIME_USER
\getenv runtime_password WHATSAPP_WORKER_RUNTIME_PASSWORD

SELECT (current_user = :'runtime_user')::text AS provisioning_as_runtime_user
\gset
\if :provisioning_as_runtime_user
  \echo 'WORKER_DB_USER must differ from the connected provisioning role'
  DO $abort$ BEGIN
    RAISE EXCEPTION 'worker runtime role provisioning aborted';
  END $abort$;
\endif

BEGIN;

SELECT format(
  'CREATE ROLE %I WITH NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_group'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'runtime_group'
) \gexec

SELECT format(
  'ALTER ROLE %I WITH NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1',
  :'runtime_group'
) \gexec

SELECT format('ALTER ROLE %I RESET ALL', :'runtime_group') \gexec

-- Membership in an object-owning group is equivalent to handing every worker
-- an owner-level RLS bypass through SET ROLE. Never attempt to repair or
-- reassign ownership implicitly, including ownership in another database.
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_shdepend AS dependency
  JOIN pg_catalog.pg_roles AS owner
    ON owner.oid = dependency.refobjid
  WHERE dependency.refclassid = 'pg_catalog.pg_authid'::regclass
    AND dependency.deptype = 'o'
    AND owner.rolname = :'runtime_group'
)::text AS runtime_group_owns_objects
\gset
\if :runtime_group_owns_objects
  \echo 'whatsapp_session_runtime owns database objects; reassign ownership explicitly before provisioning'
  DO $abort$ BEGIN
    RAISE EXCEPTION 'worker runtime role provisioning aborted';
  END $abort$;
\endif

-- Database-specific role settings survive ALTER ROLE RESET ALL. Remove them
-- cluster-wide so an old search_path/default role cannot reappear only when
-- the worker connects to a particular database.
SELECT format(
  'ALTER ROLE %I IN DATABASE %I RESET ALL',
  :'runtime_group',
  database.datname
)
FROM pg_catalog.pg_db_role_setting AS setting
JOIN pg_catalog.pg_roles AS role ON role.oid = setting.setrole
JOIN pg_catalog.pg_database AS database ON database.oid = setting.setdatabase
WHERE role.rolname = :'runtime_group'
ORDER BY database.datname
\gexec

-- The group itself must not inherit privileges from an unrelated role.
SELECT format('REVOKE %I FROM %I', granted_role.rolname, :'runtime_group')
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS granted_role
  ON granted_role.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
WHERE member_role.rolname = :'runtime_group'
ORDER BY granted_role.rolname
\gexec

SELECT format(
  'CREATE ROLE %I WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'runtime_user',
  :'runtime_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'runtime_user'
) \gexec

-- Reapplying the script is the supported password-rotation path.
SELECT format(
  'ALTER ROLE %I WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD %L VALID UNTIL %L',
  :'runtime_user',
  :'runtime_password',
  'infinity'
) \gexec

SELECT format('ALTER ROLE %I RESET ALL', :'runtime_user') \gexec

SELECT format(
  'ALTER ROLE %I IN DATABASE %I RESET ALL',
  :'runtime_user',
  database.datname
)
FROM pg_catalog.pg_db_role_setting AS setting
JOIN pg_catalog.pg_roles AS role ON role.oid = setting.setrole
JOIN pg_catalog.pg_database AS database ON database.oid = setting.setdatabase
WHERE role.rolname = :'runtime_user'
ORDER BY database.datname
\gexec

-- Password rotation may also rename the shared LOGIN. A member left behind
-- would retain the complete runtime allowlist, so disable every previous
-- login and remove every old membership atomically. Object ownership is not
-- guessed or reassigned; NOLOGIN keeps such a role available for an explicit
-- operator-led cleanup.
SELECT format('ALTER ROLE %I NOLOGIN', member_role.rolname)
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS granted_role
  ON granted_role.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
WHERE granted_role.rolname = :'runtime_group'
  AND member_role.rolname <> :'runtime_user'
  AND member_role.rolcanlogin
ORDER BY member_role.rolname
\gexec

SELECT format('REVOKE %I FROM %I', :'runtime_group', member_role.rolname)
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS granted_role
  ON granted_role.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
WHERE granted_role.rolname = :'runtime_group'
  AND member_role.rolname <> :'runtime_user'
ORDER BY member_role.rolname
\gexec

-- Never repurpose an application/object-owner login as the worker runtime.
-- DROP OWNED would destroy owned objects, while REASSIGN OWNED would guess an
-- owner. Abort and require an explicit operator-led ownership migration.
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_shdepend AS dependency
  JOIN pg_catalog.pg_roles AS owner
    ON owner.oid = dependency.refobjid
  WHERE dependency.refclassid = 'pg_catalog.pg_authid'::regclass
    AND dependency.deptype = 'o'
    AND owner.rolname = :'runtime_user'
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_class AS object
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = object.relowner
  WHERE owner.rolname = :'runtime_user'
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_proc AS object
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = object.proowner
  WHERE owner.rolname = :'runtime_user'
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_namespace AS object
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = object.nspowner
  WHERE owner.rolname = :'runtime_user'
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_type AS object
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = object.typowner
  WHERE owner.rolname = :'runtime_user'
    AND object.typrelid = 0
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_database AS object
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = object.datdba
  WHERE owner.rolname = :'runtime_user'
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_tablespace AS object
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = object.spcowner
  WHERE owner.rolname = :'runtime_user'
)::text AS runtime_user_owns_objects
\gset
\if :runtime_user_owns_objects
  \echo 'WORKER_DB_USER owns database objects; reassign ownership explicitly before provisioning'
  DO $abort$ BEGIN
    RAISE EXCEPTION 'worker runtime role provisioning aborted';
  END $abort$;
\endif

-- A pre-existing login is reduced to the single intended group membership.
SELECT format('REVOKE %I FROM %I', granted_role.rolname, :'runtime_user')
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS granted_role
  ON granted_role.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
WHERE member_role.rolname = :'runtime_user'
  AND granted_role.rolname <> :'runtime_group'
ORDER BY granted_role.rolname
\gexec

-- Remove stale/manual ACLs granted directly to a pre-existing login. Runtime
-- access must come exclusively from the audited NOLOGIN group allowlist.
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
  :'runtime_user'
) \gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
  :'runtime_user'
) \gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I',
  :'runtime_user'
) \gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
  :'runtime_user'
) \gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
  current_database(),
  :'runtime_user'
) \gexec

-- PUBLIC must not let any login create an object that can shadow an unqualified
-- name. All SECURITY DEFINER functions also pin search_path, but closing this
-- default removes the broader database attack primitive.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I',
  current_database(),
  :'runtime_user'
) \gexec

-- Recreate the one intended membership instead of trying to repair option
-- bits in place. PostgreSQL defaults are non-admin and inheritable/settable.
SELECT format('REVOKE %I FROM %I', :'runtime_group', :'runtime_user') \gexec
SELECT format('GRANT %I TO %I', :'runtime_group', :'runtime_user') \gexec

SELECT (
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    WHERE granted_role.rolname = :'runtime_group'
      AND member_role.rolname <> :'runtime_user'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    WHERE granted_role.rolname = :'runtime_group'
      AND member_role.rolname = :'runtime_user'
      AND NOT membership.admin_option
  )
)::text AS runtime_group_membership_invalid
\gset
\if :runtime_group_membership_invalid
  \echo 'whatsapp_session_runtime must have exactly one non-admin member'
  DO $abort$ BEGIN
    RAISE EXCEPTION 'worker runtime role provisioning aborted';
  END $abort$;
\endif

-- Catalog-level postconditions inspect direct ACL entries, not effective
-- privileges inherited from whatsapp_session_runtime.
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_class AS object
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(object.relacl, pg_catalog.acldefault(
      CASE WHEN object.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
      object.relowner
    ))
  ) AS acl
  JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = object.relnamespace
  WHERE namespace.nspname = 'public'
    AND grantee.rolname = :'runtime_user'
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_proc AS object
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(object.proacl, pg_catalog.acldefault('f'::"char", object.proowner))
  ) AS acl
  JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = object.pronamespace
  WHERE namespace.nspname = 'public'
    AND grantee.rolname = :'runtime_user'
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_namespace AS namespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(namespace.nspacl, pg_catalog.acldefault('n'::"char", namespace.nspowner))
  ) AS acl
  JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
  WHERE namespace.nspname = 'public'
    AND grantee.rolname = :'runtime_user'
  UNION ALL
  SELECT 1
  FROM pg_catalog.pg_database AS database
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(database.datacl, pg_catalog.acldefault('d'::"char", database.datdba))
  ) AS acl
  JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
  WHERE database.datname = current_database()
    AND grantee.rolname = :'runtime_user'
    AND acl.privilege_type <> 'CONNECT'
)::text AS runtime_user_has_direct_object_acl
\gset
\if :runtime_user_has_direct_object_acl
  \echo 'WORKER_DB_USER retained a direct table/sequence/function/schema/database ACL'
  DO $abort$ BEGIN
    RAISE EXCEPTION 'worker runtime role provisioning aborted';
  END $abort$;
\endif

-- pg_shdepend is cluster-wide. It catches ownership, ACLs in another
-- database, default privileges and non-public grants that cannot be safely
-- rewritten while connected here. The only permitted direct dependency is
-- CONNECT on this database; every object privilege must come from the group.
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_shdepend AS dependency
  JOIN pg_catalog.pg_roles AS grantee
    ON grantee.oid = dependency.refobjid
  WHERE dependency.refclassid = 'pg_catalog.pg_authid'::regclass
    AND grantee.rolname = :'runtime_user'
    AND dependency.deptype IN ('a', 'o')
    AND NOT (
      dependency.deptype = 'a'
      AND dependency.dbid = 0
      AND dependency.classid = 'pg_catalog.pg_database'::regclass
      AND dependency.objid = (
        SELECT database.oid
        FROM pg_catalog.pg_database AS database
        WHERE database.datname = current_database()
      )
    )
)::text AS runtime_user_has_external_dependency
\gset
\if :runtime_user_has_external_dependency
  \echo 'WORKER_DB_USER retains ownership or a direct ACL outside the audited database allowlist'
  DO $abort$ BEGIN
    RAISE EXCEPTION 'worker runtime role provisioning aborted';
  END $abort$;
\endif

SELECT (
  has_schema_privilege('public', 'public', 'CREATE')
  OR NOT has_database_privilege(:'runtime_user', current_database(), 'CONNECT')
  OR has_database_privilege(:'runtime_user', current_database(), 'CREATE')
)::text AS runtime_database_acl_invalid
\gset
\if :runtime_database_acl_invalid
  \echo 'worker runtime database/schema ACL postcondition failed'
  DO $abort$ BEGIN
    RAISE EXCEPTION 'worker runtime role provisioning aborted';
  END $abort$;
\endif

COMMIT;

SELECT rolname,
       rolcanlogin,
       rolsuper,
       rolcreatedb,
       rolcreaterole,
       rolreplication,
       rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname IN (:'runtime_group', :'runtime_user')
ORDER BY rolname;
SQL
