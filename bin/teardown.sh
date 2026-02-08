#!/bin/bash
# teardown.sh — Clean destroy of all VPN resources
# Usage: ./bin/teardown.sh [--force]
source "$(dirname "$0")/lib.sh"
validate_config

echo "╔══════════════════════════════════════════╗"
echo "║   WireGuard VPN — Teardown               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Confirm unless --force
if [ "${1:-}" != "--force" ]; then
    echo "⚠️  This will DESTROY your VPN server and all configs."
    echo ""
    read -p "Are you sure? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

# Delete VM
log_info "Deleting VM instance: ${VM_NAME}..."
if vm_exists; then
    gcloud compute instances delete "$VM_NAME" \
        --project="$GCP_PROJECT" --zone="$GCP_ZONE" --quiet
    log_ok "VM deleted"
else
    echo "      VM not found, skipping."
fi

# Delete firewall rule
echo ""
log_info "Deleting firewall rule: ${FIREWALL_RULE}..."
if gcloud compute firewall-rules describe "$FIREWALL_RULE" --project="$GCP_PROJECT" &>/dev/null; then
    gcloud compute firewall-rules delete "$FIREWALL_RULE" \
        --project="$GCP_PROJECT" --quiet
    log_ok "Firewall rule deleted"
else
    echo "      Firewall rule not found, skipping."
fi

# Clean local client configs
echo ""
log_info "Cleaning local client configs..."
if ls "${CLIENT_DIR}"/*.conf &>/dev/null; then
    rm -f "${CLIENT_DIR}"/*.conf
    log_ok "Client configs removed"
else
    echo "      No client configs found."
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅ All VPN resources destroyed          ║"
echo "║   No more charges will be incurred.       ║"
echo "╚══════════════════════════════════════════╝"
