-- Keep future functions created by the Atlas owner from silently restoring
-- PostgreSQL's default PUBLIC EXECUTE grant. Explicit application grants, when
-- needed for a different login role, must be declared by the same migration
-- that creates the function.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
