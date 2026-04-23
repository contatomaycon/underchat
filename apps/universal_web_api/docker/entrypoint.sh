#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/app"
PERSIST_ROOT="${PERSIST_ROOT:-/data}"
DEFAULT_CONFIG_DIR="${APP_ROOT}/config.dist"

CONFIG_DIR="${PERSIST_ROOT}/config"
CHROME_PROFILE_DIR="${PERSIST_ROOT}/chrome_profile"
IMAGE_DIR="${PERSIST_ROOT}/image"
DOWNLOAD_IMAGES_DIR="${PERSIST_ROOT}/download_images"

export APP_HOST="${APP_HOST:-0.0.0.0}"
export APP_PORT="${APP_PORT:-8199}"
export BROWSER_PORT="${BROWSER_PORT:-9222}"
export DISPLAY="${DISPLAY:-:99}"
export VNC_PORT="${VNC_PORT:-5900}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export AUTO_UPDATE_ENABLED="${AUTO_UPDATE_ENABLED:-false}"

mkdir -p "${CONFIG_DIR}" "${CHROME_PROFILE_DIR}" "${IMAGE_DIR}" "${DOWNLOAD_IMAGES_DIR}"

seed_config_file() {
  local name="$1"
  if [ ! -f "${CONFIG_DIR}/${name}" ] && [ -f "${DEFAULT_CONFIG_DIR}/${name}" ]; then
    cp -a "${DEFAULT_CONFIG_DIR}/${name}" "${CONFIG_DIR}/${name}"
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
