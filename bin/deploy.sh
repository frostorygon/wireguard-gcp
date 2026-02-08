#!/bin/bash
# deploy.sh — One-command WireGuard VPN deployment to Google Cloud
# Usage: ./bin/deploy.sh
source "$(dirname "$0")/lib.sh"
validate_config

echo "╔══════════════════════════════════════════╗"
echo "║   WireGuard VPN — GCP Deploy             ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Region:  ${GCP_REGION}"
echo "║  Zone:    ${GCP_ZONE}"
echo "║  VM:      ${MACHINE_TYPE}"
echo "║  Project: ${GCP_PROJECT}"
echo "╚══════════════════════════════════════════╝"
echo ""

# --- Step 1: Create firewall rule ---
log_info "Creating firewall rule for WireGuard (UDP ${WG_PORT})..."
if gcloud compute firewall-rules describe "$FIREWALL_RULE" --project="$GCP_PROJECT" &>/dev/null; then
    echo "      Firewall rule already exists, skipping."
else
    gcloud compute firewall-rules create "$FIREWALL_RULE" \
        --project="$GCP_PROJECT" \
        --direction=INGRESS \
        --priority=1000 \
        --network=default \
        --action=ALLOW \
        --rules=udp:"${WG_PORT}" \
        --source-ranges=0.0.0.0/0 \
        --target-tags=wireguard \
        --quiet
    log_ok "Firewall rule created"
fi

# --- Step 2: Create VM instance ---
echo ""
log_info "Creating VM instance: ${VM_NAME}..."
if vm_exists; then
    echo "      VM already exists, skipping creation."
else
    gcloud compute instances create "$VM_NAME" \
        --project="$GCP_PROJECT" \
        --zone="$GCP_ZONE" \
        --machine-type="$MACHINE_TYPE" \
        --image-family="$IMAGE_FAMILY" \
        --image-project="$IMAGE_PROJECT" \
        --boot-disk-size="${DISK_SIZE}GB" \
        --boot-disk-type=pd-standard \
        --tags=wireguard \
        --metadata=enable-oslogin=true \
        --quiet
    log_ok "VM created"

    log_info "Waiting for VM to be ready..."
    sleep 15
fi

# Get the external IP
SERVER_IP=$(vm_ip)
echo "      External IP: ${SERVER_IP}"

# --- Step 3: Setup WireGuard via metadata script ---
echo ""
log_info "Setting up WireGuard on VM..."

# Set the server setup script as metadata and execute it
gcloud compute instances add-metadata "$VM_NAME" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --metadata-from-file=startup-script="${PROJECT_ROOT}/server/setup-server.sh" \
    --quiet

# Execute the startup script via SSH
SETUP_OUTPUT=$(gcloud compute ssh "$VM_NAME" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="curl -s http://metadata.google.internal/computeMetadata/v1/instance/attributes/startup-script -H 'Metadata-Flavor: Google' > /tmp/setup.sh && chmod +x /tmp/setup.sh && sudo bash /tmp/setup.sh" \
    --quiet 2>&1)

echo "$SETUP_OUTPUT"
log_ok "WireGuard configured on server"

# --- Step 4: Generate first client ---
echo ""
log_info "Generating first client config..."
bash "${PROJECT_ROOT}/bin/generate-client.sh" "default"

# --- Step 5: Summary ---
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║           🎉 VPN DEPLOYED SUCCESSFULLY!          ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  Server IP:    ${SERVER_IP}"
echo "║  Region:       ${GCP_REGION}"
echo "║  Protocol:     WireGuard (UDP ${WG_PORT})"
echo "║                                                  ║"
echo "║  Client config: ./clients/default.conf           ║"
echo "║                                                  ║"
echo "║  Next steps:                                     ║"
echo "║  1. Import clients/default.conf into WireGuard   ║"
echo "║  2. Connect and browse privately!                ║"
echo "║  3. Add more: ./bin/generate-client.sh phone     ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
