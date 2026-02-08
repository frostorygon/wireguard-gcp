#!/bin/bash
# lib.sh — Shared configuration loader for all VPN scripts
# Sources the .env file and provides common utilities
# This file is sourced by other scripts, not executed directly

set -euo pipefail

# Resolve project root (parent of bin/ or server/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" && pwd)"
if [[ "$SCRIPT_DIR" == */bin ]] || [[ "$SCRIPT_DIR" == */server ]]; then
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
else
    PROJECT_ROOT="$SCRIPT_DIR"
fi

ENV_FILE="${PROJECT_ROOT}/config/.env"
CLIENT_DIR="${PROJECT_ROOT}/clients"

# --- Load config ---
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Config file not found at ${ENV_FILE}"
    echo "Run: cp config/.env.example config/.env"
    echo "Then edit config/.env with your GCP project details."
    exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

# --- Validate required vars ---
validate_config() {
    local missing=()
    [ -z "${GCP_PROJECT:-}" ] && missing+=("GCP_PROJECT")
    [ -z "${GCP_ZONE:-}" ] && missing+=("GCP_ZONE")
    [ -z "${VM_NAME:-}" ] && missing+=("VM_NAME")

    if [ ${#missing[@]} -gt 0 ]; then
        echo "Error: Missing required config vars: ${missing[*]}"
        echo "Edit config/.env to set them."
        exit 1
    fi
}

# --- Common utilities ---
log_info()  { echo "[*] $*"; }
log_ok()    { echo "[✓] $*"; }
log_warn()  { echo "[!] $*"; }
log_error() { echo "[✗] $*" >&2; }

vm_exists() {
    gcloud compute instances describe "$VM_NAME" --zone="$GCP_ZONE" &>/dev/null
}

vm_ip() {
    gcloud compute instances describe "$VM_NAME" --zone="$GCP_ZONE" \
        --format="get(networkInterfaces[0].accessConfigs[0].natIP)" 2>/dev/null
}

vm_ssh() {
    gcloud compute ssh "$VM_NAME" --zone="$GCP_ZONE" --command="$1" --quiet 2>/dev/null
}
