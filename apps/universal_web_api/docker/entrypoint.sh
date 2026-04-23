#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/app"
PERSIST_ROOT="${PERSIST_ROOT:-/data}"
DEFAULT_CONFIG_DIR="${APP_ROOT}/config.dist"

is_writable_dir() {
  local dir="$1"
  mkdir -p "${dir}" >/dev/null 2>&1 || return 1

  local probe_file="${dir}/.underchat-write-test-$$"
  if ! (umask 077 && : > "${probe_file}") >/dev/null 2>&1; then
    return 1
  fi
  rm -f "${probe_file}" >/dev/null 2>&1 || true
  return 0
}

resolve_persist_root() {
  local primary_root="$1"
  local fallback_root="${TMP_PERSIST_ROOT:-/tmp/data}"

  if is_writable_dir "${primary_root}"; then
    printf '%s' "${primary_root}"
    return 0
  fi

  echo "[entrypoint] WARN: persist root '${primary_root}' is not writable; falling back to '${fallback_root}'." >&2
  if is_writable_dir "${fallback_root}"; then
    printf '%s' "${fallback_root}"
    return 0
  fi

  echo "[entrypoint] ERROR: neither '${primary_root}' nor fallback '${fallback_root}' are writable." >&2
  return 1
}

export APP_HOST="${APP_HOST:-0.0.0.0}"
export APP_PORT="${APP_PORT:-8199}"
export BROWSER_PORT="${BROWSER_PORT:-9222}"
export DISPLAY="${DISPLAY:-:99}"
export VNC_PORT="${VNC_PORT:-5900}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export AUTO_UPDATE_ENABLED="${AUTO_UPDATE_ENABLED:-false}"

# Non-root runtime defaults required by fluxbox/chromium in Kubernetes.
if [ -z "${HOME:-}" ] || [ "${HOME}" = "/" ]; then
  export HOME="/tmp/home"
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
mkdir -p "${HOME}" "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}" || true

PERSIST_ROOT="$(resolve_persist_root "${PERSIST_ROOT}")"
CONFIG_DIR="${PERSIST_ROOT}/config"
CHROME_PROFILE_DIR="${PERSIST_ROOT}/chrome_profile"
IMAGE_DIR="${PERSIST_ROOT}/image"
DOWNLOAD_IMAGES_DIR="${PERSIST_ROOT}/download_images"

mkdir -p "${CONFIG_DIR}" "${CHROME_PROFILE_DIR}" "${IMAGE_DIR}" "${DOWNLOAD_IMAGES_DIR}"

seed_config_file() {
  local name="$1"
  if [ ! -f "${CONFIG_DIR}/${name}" ] && [ -f "${DEFAULT_CONFIG_DIR}/${name}" ]; then
    if ! cp -a "${DEFAULT_CONFIG_DIR}/${name}" "${CONFIG_DIR}/${name}"; then
      echo "[entrypoint] WARN: failed to seed config '${name}' into '${CONFIG_DIR}'." >&2
    fi
  fi
}

for file in \
  browser_config.json \
  commands.json \
  commands.local.json \
  extractors.json \
  image_presets.json \
  marketplace.json \
  marketplace_cache.json \
  sites.json \
  sites.local.json; do
  seed_config_file "${file}"
done

rm -rf "${APP_ROOT}/config" "${APP_ROOT}/chrome_profile" "${APP_ROOT}/image" "${APP_ROOT}/download_images"
ln -sfn "${CONFIG_DIR}" "${APP_ROOT}/config"
ln -sfn "${CHROME_PROFILE_DIR}" "${APP_ROOT}/chrome_profile"
ln -sfn "${IMAGE_DIR}" "${APP_ROOT}/image"
ln -sfn "${DOWNLOAD_IMAGES_DIR}" "${APP_ROOT}/download_images"

Xvfb "${DISPLAY}" -screen 0 "${XVFB_SCREEN:-1920x1080x24}" -nolisten tcp &
for _ in $(seq 1 100); do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
fluxbox -display "${DISPLAY}" &

if [ -n "${VNC_PASSWORD:-}" ]; then
  VNC_PASS_FILE="/tmp/x11vnc.pass"
  x11vnc -storepasswd "${VNC_PASSWORD}" "${VNC_PASS_FILE}" >/dev/null
  x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" -forever -shared -xkb -repeat -rfbauth "${VNC_PASS_FILE}" &
else
  x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" -forever -shared -xkb -repeat -nopw &
fi

/usr/share/novnc/utils/novnc_proxy --vnc "127.0.0.1:${VNC_PORT}" --listen "${NOVNC_PORT}" --web /usr/share/novnc &

CHROMIUM_BIN="${CHROMIUM_BIN:-/usr/bin/chromium}"
"${CHROMIUM_BIN}" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="${BROWSER_PORT}" \
  --user-data-dir="${CHROME_PROFILE_DIR}" \
  --password-store=basic \
  --use-mock-keychain \
  --disable-crash-reporter \
  --no-sandbox \
  --disable-setuid-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --disable-backgrounding-occluded-windows \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-features=CalculateNativeWinOcclusion,AutomaticTabDiscarding,TabFreeze,IntensiveWakeUpThrottling \
  about:blank &

cd "${APP_ROOT}"
exec python3 main.py
