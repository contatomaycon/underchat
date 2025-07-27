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
    'sudo apt-get update',
    'sudo apt-get upgrade -y',

    'sudo apt-get install git -y',
    'sudo apt-get install curl -y',
    'sudo apt-get install wget -y',
    'sudo apt-get install htop -y',
    'sudo apt-get install zip -y',
    'sudo apt-get install build-essential -y',
    'sudo apt-get install ca-certificates -y',
    'sudo apt-get install libssl-dev -y',
    'sudo apt-get install gnupg -y',
    'sudo apt-get install lsb-release -y',

    'sudo rm -rf /home/app || true',
    'sudo rm -rf /home/underchat || true',

    `bash -lc 'export NVM_DIR="$HOME/.nvm" && \
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
      . "$NVM_DIR/nvm.sh"'`,

    `bash -lc 'export NVM_DIR="$HOME/.nvm" && \
      . "$NVM_DIR/nvm.sh" && \
      nvm install ${nodeVersion} && \
      nvm use ${nodeVersion} && \
      nvm alias default ${nodeVersion}'`,

    `bash -ic "sudo mkdir -p /etc/apt/keyrings && \
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg"`,

    `bash -ic "echo 'deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable' \
      | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null"`,

    `bash -ic "sudo apt-get update && \
      sudo apt-get install -y docker-ce docker-ce-cli containerd.io"`,

    `bash -ic "sudo apt-get update && \
      sudo apt-get install -y docker-compose-plugin"`,

    `bash -ic "sudo rm -f /usr/local/bin/docker-compose || true"`,

    `bash -ic "sudo mkdir -p /usr/local/bin && \
      sudo ln -sf /usr/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose"`,

    `bash -ic "sudo groupadd docker && \
      sudo usermod -aG docker $USER && \
      sudo systemctl enable docker && \
      sudo systemctl start docker"`,

    `bash -ic "sudo mkdir -p /home/app && \
      sudo chown $USER:$USER /home/app && \
      git clone --single-branch --branch ${generalEnvironment.gitBranch} https://oauth2:${generalEnvironment.gitToken}@${generalEnvironment.gitRepo} /home/app"`,

    `bash -ic "printf '%b' '${envContent}' > /home/app/.env && sudo chown $USER:$USER /home/app/.env"`,

    `bash -ic "cd /home/app && \
      docker compose down -v under-worker-baileys"`,

    `bash -ic "cd /home/app && \
    sudo docker compose build --no-cache under-worker-baileys"`,

    `bash -ic "cd /home/app && \
      sudo docker stop under-balance-api || true && \
      sudo docker rm under-balance-api || true"`,

    `bash -ic "cd /home/app && \
      sudo docker build --no-cache -t under-balance-api:latest -f ./apps/balance_api/Dockerfile ."`,

    `bash -ic "cd /home/app && \
      sudo docker network create underchat || true"`,

    `bash -ic "cd /home/app && \
      sudo docker run -d --name under-balance-api \
        --restart always \
        -p ${webView.web_port}:3003 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --network underchat \
        -e DOCKER_HOST=unix:///var/run/docker.sock \
        under-balance-api:latest"`,

    'sudo rm -rf /home/app || true',
  ];
}
