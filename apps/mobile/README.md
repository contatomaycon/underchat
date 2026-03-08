# Mobile (Expo)

## Textos para App Store iOS

- Arquivo com textos prontos para App Store Connect (pt-BR): `README_APP_STORE_IOS_TEXTOS.md`

## Pré-requisitos gerais

- Node na versão exigida pelo monorepo
- Dependências instaladas: `pnpm install`
- Login no Expo/EAS: `pnpm exec eas login`
- Confirmar conta autenticada: `pnpm --filter mobile exec eas whoami`

---

## iOS (TestFlight / App Store Connect)

### 1) Pré-requisitos da Apple

Antes de gerar build para loja, confirme:

- Conta Apple Developer ativa
- Acesso ao App Store Connect com permissão para builds e TestFlight
- App criado no App Store Connect com o mesmo Bundle ID: `com.underchat.mobile`

### 2) Gerar build iOS de produção

No diretório do monorepo:

- Build iOS para loja/TestFlight: `pnpm --filter mobile run eas:build:prod:ios`

Esse comando usa o perfil `production-ios` no EAS (`distribution: store`).

### 3) Acompanhar o build

- O terminal exibe a URL do build no dashboard da Expo
- Aguarde o status `Finished`

### 4) Enviar build para TestFlight

Após o build concluir:

- Enviar para App Store Connect/TestFlight: `pnpm --filter mobile run eas:submit:ios`

Esse comando usa o perfil `production-ios` na seção `submit` do EAS.

### 5) Validar no App Store Connect

- Abra App Store Connect → seu app → TestFlight
- Aguarde estado `Processing` e depois `Ready to Test`
- Convide testadores internos/externos

### 6) Checklist para próximos envios

- Incrementar versão/build iOS antes de um novo envio
- Validar variáveis públicas de ambiente (ex.: `EXPO_PUBLIC_BACKEND_URL`)
- Revisar permissões e metadados do app no App Store Connect

---

## Android

### Regra de notificações (Android e iOS)

- Toggle em Perfil > Configurações > Notificação:
  - Ao desativar, o app persiste `notifications=false` no perfil e interrompe o recebimento de push.
  - Ao ativar, o app solicita permissão (se necessário), registra o endpoint push e persiste `notifications=true`.
- Logout (`Sair`) sempre encerra a sessão push no servidor e remove o endpoint local.
- Logout automático por sessão inválida (`401`) também encerra inscrição de push.
- No login/boot autenticado, o app sincroniza o usuário com o backend e:
  - se `chat_user.notifications=true`, registra push;
  - se `chat_user.notifications=false`, garante desinscrição de push.

### Configuração de mapa com MapLibre (Localização no chat)

O app usa MapLibre no seletor de localização e não exige chave do Google Maps.

Variável de estilo do mapa:

- `EXPO_PUBLIC_MAPLIBRE_STYLE_URL` (padrão: `https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json`)

Local (dev client / `run:android`):

- Copie `.env.example` para `.env`
- Ajuste `EXPO_PUBLIC_MAPLIBRE_STYLE_URL` se quiser usar outro estilo

- Rebuild nativo é recomendado após instalar/alterar provider de mapa
- iOS (EAS): após instalar/alterar o MapLibre, gere um novo build para aplicar mudanças no Podfile via config plugin
- Se ocorrer erro de cache no EAS, rode com cache limpo: `pnpm --filter mobile exec eas build --profile development --platform ios --clear-cache`

- Android
  export ANDROID_HOME="$HOME/Android/Sdk"
  export PATH="$ANDROID_HOME/platform-tools:$PATH"

  rm -rf android/.cxx android/app/.cxx android/build android/app/build

  pnpm install

  pnpm run run:android
  pnpm exec expo start --dev-client --android --tunnel --clear

Comandos:

- Gerar APK (distribuição interna): `pnpm --filter mobile run build:android:apk`
- Gerar AAB (release/Play Store): `pnpm --filter mobile run build:android:aab`

Execução local:

- Rodar app no Android nativo: `pnpm --filter mobile run run:android`
- Rodar dev client no Android: `pnpm --filter mobile run android:dev-client`

Perfis EAS usados:

- `preview-apk` → `apk`
- `production-aab` → `app-bundle`

Após iniciar o build, o link do artefato é exibido no terminal e também no dashboard da Expo.
