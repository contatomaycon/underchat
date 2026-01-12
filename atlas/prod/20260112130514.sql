DELETE FROM "permission_role_action" WHERE "permission_action_id" IN (
  '019a930d-c6f7-7374-86ab-132cf8368c6c',
  '019a930d-c6f7-7374-86ab-1477caa27afc',
  '019a930d-c6f7-7374-86ab-183b58b0ab7c',
  '019a930d-c6f7-7374-86ab-1da6ffd7a369'
);

DELETE FROM "permission_action" WHERE "action" IN (
  'account_view',
  'account_create',
  'account_update',
  'account_delete'
);