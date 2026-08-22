import path from 'node:path';
import { getPackageNodeVersion } from './getPackageNodeVersion';
import { buildEnvironment } from '@core/config/environments';
import { readEnvFile } from './readEnvFile';
import { IViewServerWebById } from '../interfaces/IViewServerWebById';
import { IServerBuildDefaultImages } from '../interfaces/IServerBuildDefaultImages';
import { escapeShellSingleQuotes } from './escapeShellSingleQuotes';
import { getHarborLoginCommand } from './getHarborLoginCommand';
import {
  getPrepareExternalAppEnvFileCommand,
  getRemoveEnvVarsFromFileCommand,
} from './getRemoveEnvVarsFromFileCommand';
import { resolveUnderchatProjectRoot } from './resolveUnderchatProjectRoot';
import { getLegacyBalanceRolloutFencedCommandSequence } from './getStartBalanceContainerCommand';

export async function installUbuntu2510(
  webView: IViewServerWebById,
  defaultImages: IServerBuildDefaultImages
): Promise<string[]> {
  const projectRoot = resolveUnderchatProjectRoot();
  const patchPackage = path.join(projectRoot, 'package.json');
  const nodeVersion = getPackageNodeVersion(patchPackage);

  const patchEnv = path.join(projectRoot, '.env');
  const envContent = await readEnvFile(patchEnv);
  const harborRegistryValue = buildEnvironment.harborRegistry;
  const harborUsernameValue = buildEnvironment.harborUsername;
  const harborPasswordValue = buildEnvironment.harborPassword;
  const baileysImage = escapeShellSingleQuotes(defaultImages.baileys);
  const wwebjsImage = escapeShellSingleQuotes(defaultImages.wwebjs);
  const whatsmeowImage = escapeShellSingleQuotes(defaultImages.whatsmeow);
  const balanceApiImage = escapeShellSingleQuotes(defaultImages.balance_api);
  const harborLoginCommand = getHarborLoginCommand({
    harborRegistry: harborRegistryValue,
    harborUsername: harborUsernameValue,
    harborPassword: harborPasswordValue,
  });
  const removeEnvVarsFromAppEnvCommand =
    getRemoveEnvVarsFromFileCommand('/home/app/.env');
  const prepareExternalAppEnvCommand =
    getPrepareExternalAppEnvFileCommand('/home/app/.env');
  const dockerSetupCommand = `DEBIAN_FRONTEND=noninteractive bash -c "mkdir -p /etc/apt/keyrings && \
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg && \
      chmod a+r /etc/apt/keyrings/docker.gpg"`;
  const rolloutReservationStartCommand = 'dpkg --configure -a';

  const commands = [
    rolloutReservationStartCommand,
    'apt-get update',

    'apt-get install curl -y',
    'apt-get install wget -y',
    'apt-get install htop -y',
    'apt-get install zip -y',
    'apt-get install build-essential -y',
    'apt-get install ca-certificates -y',
    'apt-get install libssl-dev -y',
    'apt-get install gnupg -y',
    'apt-get install lsb-release -y',
    'DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::="--force-confnew" openssh-client',

    `bash -lc 'export NVM_DIR="$HOME/.nvm" && \
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
      . "$NVM_DIR/nvm.sh"'`,

    `bash -lc 'export NVM_DIR="$HOME/.nvm" && \
      . "$NVM_DIR/nvm.sh" && \
      nvm install ${nodeVersion} && \
      nvm use ${nodeVersion} && \
      nvm alias default ${nodeVersion}'`,

    dockerSetupCommand,

    `DEBIAN_FRONTEND=noninteractive bash -c 'DISTRO=$(lsb_release -cs) && \
      if [ "$DISTRO" = "noble" ] || [ "$DISTRO" = "oracular" ] || [ "$DISTRO" = "questing" ]; then \
        DISTRO="jammy"; \
      fi && \
      ARCH=$(dpkg --print-architecture) && \
      rm -f /etc/apt/sources.list.d/docker.list && \
      printf "deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\\n" "$ARCH" "$DISTRO" > /etc/apt/sources.list.d/docker.list && \
      apt-get update'`,

    `DEBIAN_FRONTEND=noninteractive bash -c "dpkg --configure -a && \
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || \
      (apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true) && \
      dpkg --configure -a && \
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      which docker && \
      docker --version"`,

    `bash -c "rm -f /usr/local/bin/docker-compose || true"`,

    `bash -c "mkdir -p /usr/local/bin && \
      ln -sf /usr/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose"`,

    `bash -c "groupadd docker 2>/dev/null || true && \
      usermod -aG docker $USER && \
      systemctl enable docker && \
      systemctl start docker && \
      sleep 3 && \
      hash -r && \
      mkdir -p /root/.docker && \
      echo '{}' > /root/.docker/config.json"`,

    'rm -rf /home/app || true',
    'rm -rf /home/underchat || true',

    `bash -c "mkdir -p /home/app && chown $USER:$USER /home/app"`,

    `bash -c "printf '%b' '${envContent}' > /home/app/.env && \
      ${removeEnvVarsFromAppEnvCommand} && \
      chown $USER:$USER /home/app/.env"`,

    prepareExternalAppEnvCommand,

    `bash -c "chown $USER:$USER /home/app/.env"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      docker network create underchat 2>/dev/null || true"`,

    harborLoginCommand,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      if ! docker --config /home/app/.docker pull '${baileysImage}'; then \
        echo 'ERROR: Docker pull failed for under-worker-baileys' >&2; \
        exit 1; \
      fi && \
      if ! docker tag '${baileysImage}' under-worker-baileys:latest; then \
        echo 'ERROR: Docker tag failed for under-worker-baileys' >&2; \
        exit 1; \
      fi"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      if ! docker --config /home/app/.docker pull '${wwebjsImage}'; then \
        echo 'ERROR: Docker pull failed for under-worker-wwebjs' >&2; \
        exit 1; \
      fi && \
      if ! docker tag '${wwebjsImage}' under-worker-wwebjs:latest; then \
        echo 'ERROR: Docker tag failed for under-worker-wwebjs' >&2; \
        exit 1; \
      fi"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      if ! docker --config /home/app/.docker pull '${whatsmeowImage}'; then \
        echo 'ERROR: Docker pull failed for under-worker-whatsmeow' >&2; \
        exit 1; \
      fi && \
      if ! docker tag '${whatsmeowImage}' under-worker-whatsmeow:latest; then \
        echo 'ERROR: Docker tag failed for under-worker-whatsmeow' >&2; \
        exit 1; \
      fi"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      if ! docker --config /home/app/.docker pull '${balanceApiImage}'; then \
        echo 'ERROR: Docker pull failed for under-balance-api' >&2; \
        exit 1; \
      fi && \
      if ! docker tag '${balanceApiImage}' under-balance-api:latest; then \
        echo 'ERROR: Docker tag failed for under-balance-api' >&2; \
        exit 1; \
      fi"`,

    `bash -c 'set -o pipefail && \
      export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      mkdir -p /home/server && \
      cd /home/app && \
      ACTIVE_BALANCE_CONTAINER_IDS=$(docker ps -aq --filter "name=^/under-balance-api$") && \
      RESERVED_PORT_CONTAINER_IDS=$({ \
        docker ps -q --filter "publish=${webView.web_port}" && \
        docker ps -q --filter "publish=50051"; \
      } | sort -u) && \
      for PORT_CONTAINER_ID in $RESERVED_PORT_CONTAINER_IDS; do \
        case " $ACTIVE_BALANCE_CONTAINER_IDS " in \
          *" $PORT_CONTAINER_ID "*) ;; \
          *) echo "ERROR: Reserved Balance port is owned by foreign container $PORT_CONTAINER_ID" >&2; exit 1 ;; \
        esac; \
      done && \
      if [ -n "$ACTIVE_BALANCE_CONTAINER_IDS" ]; then \
        docker rm -f $ACTIVE_BALANCE_CONTAINER_IDS; \
      fi && \
      CONTAINER_ID=$(docker run -d --name under-balance-api \
        --restart always \
        --stop-timeout 10 \
        -p ${webView.web_port}:3003 \
        -p 50051:50051 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --env-file /home/app/.env \
        --network underchat \
        -e DOCKER_HOST=unix:///var/run/docker.sock \
        -e SERVER_ID=${webView.server_id} \
        under-balance-api:latest 2>&1 | tee -a /home/server/log_${webView.server_id}.log); \
      EXIT_CODE=$?; \
      if [ $EXIT_CODE -eq 0 ] && [ -n "$CONTAINER_ID" ] && echo "$CONTAINER_ID" | grep -qE "^[a-f0-9]{64}$"; then \
        sleep 2 && \
        if docker ps --filter id=$CONTAINER_ID --filter status=running --format "{{.ID}}" | grep -q .; then \
          echo "SUCCESS: Container under-balance-api started with ID: $CONTAINER_ID" | tee -a /home/server/log_${webView.server_id}.log; \
        else \
          echo "ERROR: Container under-balance-api failed to start. ID: $CONTAINER_ID" | tee -a /home/server/log_${webView.server_id}.log; \
          docker logs under-balance-api 2>&1 | tail -20 | tee -a /home/server/log_${webView.server_id}.log; \
          exit 1; \
        fi; \
      else \
        echo "ERROR: Failed to create container. Exit code: $EXIT_CODE. Output: $CONTAINER_ID" | tee -a /home/server/log_${webView.server_id}.log; \
        docker rm -f under-balance-api >/dev/null 2>&1 || true; \
        exit 1; \
      fi'`,

    'rm -rf /home/app || true',
  ];
  return getLegacyBalanceRolloutFencedCommandSequence(
    commands,
    rolloutReservationStartCommand,
    'rm -rf /home/app || true'
  );
}
