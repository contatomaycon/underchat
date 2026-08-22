CREATE TABLE IF NOT EXISTS "download_artifact_config" (
  "download_artifact_config_id" uuid PRIMARY KEY NOT NULL,
  "artifact_key" varchar(120) NOT NULL,
  "url" varchar(2000),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "download_artifact_config_artifact_key_uidx"
  ON "download_artifact_config" ("artifact_key");

INSERT INTO "download_artifact_config" (
  "download_artifact_config_id",
  "artifact_key",
  "url"
) VALUES
  (gen_random_uuid(), 'authenticator_dev_linux_deb', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/dev/linux.deb'),
  (gen_random_uuid(), 'authenticator_dev_linux_appimage', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/dev/linux.AppImage'),
  (gen_random_uuid(), 'authenticator_dev_macos_dmg', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/dev/macos.dmg'),
  (gen_random_uuid(), 'authenticator_dev_macos_zip', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/dev/macos.zip'),
  (gen_random_uuid(), 'authenticator_dev_windows_exe', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/dev/windows.exe'),
  (gen_random_uuid(), 'authenticator_dev_windows_blockmap', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/dev/windows.exe.blockmap'),
  (gen_random_uuid(), 'authenticator_prod_linux_deb', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/prod/linux.deb'),
  (gen_random_uuid(), 'authenticator_prod_linux_appimage', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/prod/linux.AppImage'),
  (gen_random_uuid(), 'authenticator_prod_macos_dmg', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/prod/macos.dmg'),
  (gen_random_uuid(), 'authenticator_prod_macos_zip', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/prod/macos.zip'),
  (gen_random_uuid(), 'authenticator_prod_windows_exe', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/prod/windows.exe'),
  (gen_random_uuid(), 'authenticator_prod_windows_blockmap', 'https://minio.devunder.com/underchat/downloads/underchat-authenticator/prod/windows.exe.blockmap'),
  (gen_random_uuid(), 'chrome_extension_dev_zip', 'https://minio.devunder.com/underchat/downloads/underchat-chrome-extension/dev/underchat-chrome-extension.zip'),
  (gen_random_uuid(), 'chrome_extension_prod_zip', 'https://minio.devunder.com/underchat/downloads/underchat-chrome-extension/prod/underchat-chrome-extension.zip')
ON CONFLICT ("artifact_key") DO NOTHING;
