#!/usr/bin/env bash
#
# Captura de Logcat filtrada para diagnóstico do Parallax Wallpaper.
# Uso:
#   ./scripts/qa/capture-logcat.sh start
#   ./scripts/qa/capture-logcat.sh stop
#
# Requer: adb disponível no PATH, aparelho conectado por USB com debug ativo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
PID_FILE="${LOG_DIR}/.capture.pid"
LOG_FILE=""

mkdir -p "${LOG_DIR}"

usage() {
  echo "Uso: $0 {start|stop}"
  exit 1
}

check_adb() {
  if ! command -v adb >/dev/null 2>&1; then
    echo "Erro: adb não encontrado no PATH." >&2
    exit 1
  fi
  if ! adb get-state >/dev/null 2>&1; then
    echo "Erro: nenhum dispositivo conectado ou adb não autorizado." >&2
    exit 1
  fi
}

start_capture() {
  check_adb
  if [[ -f "${PID_FILE}" ]]; then
    echo "Captura já em andamento. Execute 'stop' antes de iniciar outra." >&2
    exit 1
  fi

  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  LOG_FILE="${LOG_DIR}/${timestamp}.log"

  adb logcat -c
  adb logcat -v threadtime > "${LOG_FILE}" &
  echo "$!" > "${PID_FILE}"

  echo "Captura iniciada:"
  echo "  PID:  $(cat "${PID_FILE}")"
  echo "  Log:  ${LOG_FILE}"
  echo
  echo "Para parar: $0 stop"
}

stop_capture() {
  if [[ ! -f "${PID_FILE}" ]]; then
    echo "Nenhuma captura em andamento." >&2
    exit 1
  fi

  local pid
  pid="$(cat "${PID_FILE}")"
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}"
    wait "${pid}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"

  echo "Captura encerrada."
  echo "Log salvo em: ${LOG_DIR}"
  ls -1t "${LOG_DIR}"/*.log 2>/dev/null | head -n 1 || true
}

case "${1:-}" in
  start) start_capture ;;
  stop) stop_capture ;;
  *) usage ;;
esac