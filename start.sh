#!/bin/sh
set -eu

BACKEND_PORT=3000 node /app/backend/server.js &
NODE_PID=$!

nginx -g "daemon off;" &
NGINX_PID=$!

shutdown() {
  kill -TERM "$NODE_PID" "$NGINX_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  wait "$NGINX_PID" 2>/dev/null || true
}

trap 'shutdown; exit 143' INT TERM

while :; do
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "Node process exited; stopping nginx"
    shutdown
    exit 1
  fi

  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    echo "Nginx process exited; stopping node"
    shutdown
    exit 1
  fi

  sleep 2
done