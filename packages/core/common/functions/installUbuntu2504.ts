import path from 'path';
import { getPackageNodeVersion } from './getPackageNodeVersion';
import { generalEnvironment } from '@core/config/environments';
import { readEnvFile } from './readEnvFile';

export async function installUbuntu2504(): Promise<string[]> {
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

    `bash -ic "export NVM_DIR=\\\"$HOME/.nvm\\\" && \
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
      source \\\"$NVM_DIR/nvm.sh\\\""`,

    `bash -ic "export NVM_DIR=\\\"$HOME/.nvm\\\" && \
      nvm install ${nodeVersion} && \
      nvm use ${nodeVersion} && \
      nvm alias default ${nodeVersion}"`,

    `bash -ic "sudo mkdir -p /etc/apt/keyrings && \
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg"`,

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

    `bash -ic "sudo docker compose build --no-cache under-balance-api"`,

    `bash -ic "sudo docker compose up -d under-balance-api"`,

    //'sudo rm -rf /home/app || true',
  ];
}
