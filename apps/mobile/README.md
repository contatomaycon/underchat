# Mobile (Expo)

## Build Android

Pré-requisitos:

- Node na versão exigida pelo monorepo
- `pnpm install`
- Login no EAS: `pnpm exec eas login`

Comandos:

- Gerar APK (distribuição interna): `cd /home/maycon/underchat/apps/mobile && pnpm run build:android:apk`
- Gerar AAB (release/Play Store): `cd /home/maycon/underchat/apps/mobile && pnpm run build:android:aab`
- Gerar TestFligter
  cd /home/maycon/underchat/apps/mobile && pnpm --filter mobile run eas:build:dev:ios
  cd /home/maycon/underchat/apps/mobile && pnpm exec expo start --dev-client --tunnel

Perfis EAS usados:

- `preview-apk` → `apk`
- `production-aab` → `app-bundle`

Após iniciar o build, o link do artefato é exibido no terminal e também no dashboard da Expo.
