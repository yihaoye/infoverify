#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

docker-compose build --no-cache infoverify

docker-compose up -d
