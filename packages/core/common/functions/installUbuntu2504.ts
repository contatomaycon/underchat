import path from 'path';
import { getPackageNodeVersion } from './getPackageNodeVersion';
import { generalEnvironment } from '@core/config/environments';
import { readEnvFile } from './readEnvFile';
import { IViewServerWebById } from '../interfaces/IViewServerWebById';

export async function installUbuntu2504(
  webView: IViewServerWebById
): Promise<string[]> {
  const patchPackage = path.join(__dirname, '../../../../package.json');
  const nodeVersion = getPackageNodeVersion(patchPackage);

  const patchEnv = path.join(__dirname, '../../../../.env');
  const envContent = await readEnvFile(patchEnv);

  return [
    'apt-get update',
    'apt-get upgrade -y',

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

    `bash -ic "mkdir -p /etc/apt/keyrings && \
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg"`,

    `bash -ic "echo 'deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable' \
      | tee /etc/apt/sources.list.d/docker.list > /dev/null"`,

    `bash -ic "apt-get update && \
      apt-get install -y docker-ce docker-ce-cli containerd.io"`,

    `bash -ic "apt-get update && \
      apt-get install -y docker-compose-plugin"`,

    `bash -ic "rm -f /usr/local/bin/docker-compose || true"`,

    `bash -ic "mkdir -p /usr/local/bin && \
      ln -sf /usr/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose"`,

    `bash -ic "groupadd docker && \
      usermod -aG docker $USER && \
      systemctl enable docker && \
      systemctl start docker"`,

    `bash -ic "mkdir -p /home/app && \
      chown $USER:$USER /home/app && \
      git clone --single-branch --branch ${generalEnvironment.gitBranch} https://oauth2:${generalEnvironment.gitToken}@${generalEnvironment.gitRepo} /home/app"`,

    `bash -ic "printf '%b' '${envContent}' > /home/app/.env && chown $USER:$USER /home/app/.env"`,

    `bash -ic "cd /home/app && \
      docker network create underchat || true"`,

    `bash -ic "cd /home/app && \
      docker stop under-worker-baileys || true && \
      docker rm under-worker-baileys || true"`,

    `bash -ic "cd /home/app && \
      docker build --no-cache -t under-worker-baileys:latest -f ./apps/worker_baileys/Dockerfile ."`,

    `bash -ic "cd /home/app && \
      docker stop under-balance-api || true && \
      docker rm under-balance-api || true"`,

    `bash -ic "cd /home/app && \
      docker build --no-cache -t under-balance-api:latest -f ./apps/balance_api/Dockerfile ."`,

    `bash -ic "cd /home/app && \
      docker run -d --name under-balance-api \
        --restart always \
        -p ${webView.web_port}:3003 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --network underchat \
        -e DOCKER_HOST=unix:///var/run/docker.sock \
        under-balance-api:latest"`,

    'rm -rf /home/app || true',
  ];
}
