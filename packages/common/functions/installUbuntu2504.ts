import path from 'node:path';
import { getPackageNodeVersion } from './getPackageNodeVersion';
import { generalEnvironment } from '@core/config/environments';
import { readEnvFile } from './readEnvFile';
import { IViewServerWebById } from '../interfaces/IViewServerWebById';

export async function installUbuntu2504(
  webView: IViewServerWebById
): Promise<string[]> {
  const patchPackage = path.join(__dirname, '../../../package.json');
  const nodeVersion = getPackageNodeVersion(patchPackage);

  const patchEnv = path.join(__dirname, '../../../.env');
  const envContent = await readEnvFile(patchEnv);

  return [
    'dpkg --configure -a',
    'apt-get update',

    'apt-get install git -y',
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

    'rm -rf /home/app || true',
    'rm -rf /home/underchat || true',

    `bash -lc 'export NVM_DIR="$HOME/.nvm" && \
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
      . "$NVM_DIR/nvm.sh"'`,

    `bash -lc 'export NVM_DIR="$HOME/.nvm" && \
      . "$NVM_DIR/nvm.sh" && \
      nvm install ${nodeVersion} && \
      nvm use ${nodeVersion} && \
      nvm alias default ${nodeVersion}'`,

    `DEBIAN_FRONTEND=noninteractive bash -c "mkdir -p /etc/apt/keyrings && \
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg && \
      chmod a+r /etc/apt/keyrings/docker.gpg"`,

    `DEBIAN_FRONTEND=noninteractive bash -c 'DISTRO=$(lsb_release -cs) && \
      if [ "$DISTRO" = "noble" ] || [ "$DISTRO" = "oracular" ]; then \
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
      hash -r"`,

    `bash -c "mkdir -p /home/app && \
      chown $USER:$USER /home/app && \
      git clone --single-branch --branch ${generalEnvironment.gitBranch} https://${generalEnvironment.gitToken}@gitea.devunder.com/${generalEnvironment.gitRepo}.git /home/app"`,

    `bash -c "printf '%b' '${envContent}' > /home/app/.env && chown $USER:$USER /home/app/.env"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      docker network create underchat 2>/dev/null || true"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      docker stop under-worker-baileys 2>/dev/null || true && \
      docker rm -f under-worker-baileys 2>/dev/null || true"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      docker build --no-cache -t under-worker-baileys:latest -f ./apps/worker_baileys/Dockerfile ."`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      if docker ps -a --format '{{.Names}}' | grep -q '^under-balance-api$'; then \
        docker stop under-balance-api 2>/dev/null || true && \
        docker rm -f under-balance-api 2>/dev/null || true; \
      fi"`,

    `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      docker build --no-cache -t under-balance-api:latest -f ./apps/balance_api/Dockerfile ."`,

    `bash -c 'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      mkdir -p /home/server && \
      cd /home/app && \
      CONTAINER_ID=$(docker run -d --name under-balance-api \
        --restart always \
        -p ${webView.web_port}:3003 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --network underchat \
        -e DOCKER_HOST=unix:///var/run/docker.sock \
        -e SERVER_ID=${webView.server_id} \
        under-balance-api:latest 2>&1 | tee -a /home/server/log_${webView.server_id}.log) && \
      EXIT_CODE=$? && \
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
        exit 1; \
      fi'`,

    'rm -rf /home/app || true',
  ];
}
