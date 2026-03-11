import { escapeShellSingleQuotes } from './escapeShellSingleQuotes';

interface IGetHarborLoginCommand {
  harborRegistry: string;
  harborUsername: string;
  harborPassword: string;
}

export function getHarborLoginCommand(input: IGetHarborLoginCommand): string {
  const harborRegistry = escapeShellSingleQuotes(input.harborRegistry);
  const harborUsername = escapeShellSingleQuotes(input.harborUsername);
  const harborPassword = escapeShellSingleQuotes(input.harborPassword);

  return `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
    hash -r && \
    cd /home/app && \
    mkdir -p /home/app/.docker && \
    if ! printf '%s\\n' '${harborPassword}' | docker --config /home/app/.docker login '${harborRegistry}' -u '${harborUsername}' --password-stdin; then \
      echo 'ERROR: Harbor docker login failed' >&2; \
      exit 1; \
    fi"`;
}
