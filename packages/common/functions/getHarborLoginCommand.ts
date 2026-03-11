import { escapeShellSingleQuotes } from './escapeShellSingleQuotes';

interface IGetHarborLoginCommand {
  harborRegistry: string;
  harborUsername: string;
  harborPassword: string;
  harborAuth: string | null;
}

export function getHarborLoginCommand(input: IGetHarborLoginCommand): string {
  const harborRegistry = escapeShellSingleQuotes(input.harborRegistry);
  const harborUsername = escapeShellSingleQuotes(input.harborUsername);
  const harborPassword = escapeShellSingleQuotes(input.harborPassword);

  if (input.harborAuth) {
    const harborAuth = escapeShellSingleQuotes(input.harborAuth);

    return `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      cd /home/app && \
      mkdir -p $HOME/.docker && \
      printf '%s' '{\"auths\":{\"${harborRegistry}\":{\"auth\":\"${harborAuth}\"}}}' > $HOME/.docker/config.json && \
      chmod 600 $HOME/.docker/config.json"`;
  }

  return `bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
    hash -r && \
    cd /home/app && \
    if ! printf '%s' '${harborPassword}' | docker login '${harborRegistry}' -u '${harborUsername}' --password-stdin; then \
      echo 'ERROR: Harbor docker login failed' >&2; \
      exit 1; \
    fi"`;
}
