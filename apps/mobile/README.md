# Mobile (Expo)

## Build Android

Pré-requisitos:

- Node na versão exigida pelo monorepo
- `pnpm install`
- Login no EAS: `pnpm exec eas login`

Comandos:

- Gerar APK (distribuição interna): `cd /home/maycon/underchat/apps/mobile && pnpm run build:android:apk`
- Gerar AAB (release/Play Store): `cd /home/maycon/underchat/apps/mobile && pnpm run build:android:aab`

Perfis EAS usados:

- `preview-apk` → `apk`
- `production-aab` → `app-bundle`

Após iniciar o build, o link do artefato é exibido no terminal e também no dashboard da Expo.
