#!/bin/bash
# generate-client.sh — Generate a new WireGuard client config
# Usage: ./bin/generate-client.sh <client-name>
# Example: ./bin/generate-client.sh phone
source "$(dirname "$0")/lib.sh"
validate_config

# --- Validate args ---
if [ $# -lt 1 ]; then
    echo "Usage: $0 <client-name>"
    echo "Example: $0 phone"
    exit 1
fi

CLIENT_NAME="$1"
CLIENT_CONF="${CLIENT_DIR}/${CLIENT_NAME}.conf"

if [ -f "$CLIENT_CONF" ]; then
    log_error "Client '${CLIENT_NAME}' already exists at ${CLIENT_CONF}"
    exit 1
fi

mkdir -p "$CLIENT_DIR"

echo "=== Generating client: ${CLIENT_NAME} ==="

# Get server external IP
log_info "Fetching server info..."
SERVER_IP=$(vm_ip)

if [ -z "$SERVER_IP" ]; then
    log_error "Could not fetch server IP. Is the VM running?"
    exit 1
fi

log_info "Server IP: ${SERVER_IP}"

# Generate everything on the server (wg is not available on Windows)
log_info "Generating keypair and registering peer on server..."
RESULT=$(vm_ssh "
    # Get server public key
    SERVER_PUB=\$(sudo cat /etc/wireguard/server_public.key)

    # Count existing peers to determine next IP
    PEER_COUNT=\$(sudo grep -c '^\[Peer\]' /etc/wireguard/wg0.conf 2>/dev/null || echo 0)
    PEER_COUNT=\$(echo \$PEER_COUNT | tr -d '[:space:]')
    NEXT_IP=\$((PEER_COUNT + 2))

    # Generate client keypair
    CLIENT_PRIV=\$(wg genkey)
    CLIENT_PUB=\$(echo \$CLIENT_PRIV | wg pubkey)

    # Add peer to running WireGuard
    sudo wg set wg0 peer \$CLIENT_PUB allowed-ips ${WG_SUBNET}.\${NEXT_IP}/32

    # Persist to config file
    echo '' | sudo tee -a /etc/wireguard/wg0.conf > /dev/null
    echo '[Peer]' | sudo tee -a /etc/wireguard/wg0.conf > /dev/null
    echo \"# ${CLIENT_NAME}\" | sudo tee -a /etc/wireguard/wg0.conf > /dev/null
    echo \"PublicKey = \$CLIENT_PUB\" | sudo tee -a /etc/wireguard/wg0.conf > /dev/null
    echo \"AllowedIPs = ${WG_SUBNET}.\${NEXT_IP}/32\" | sudo tee -a /etc/wireguard/wg0.conf > /dev/null

    # Output values
    echo \"CLIENT_PRIVATE_KEY=\$CLIENT_PRIV\"
    echo \"SERVER_PUBLIC_KEY=\$SERVER_PUB\"
    echo \"CLIENT_IP=${WG_SUBNET}.\${NEXT_IP}\"
")

# Parse results
CLIENT_PRIVATE_KEY=$(echo "$RESULT" | grep "CLIENT_PRIVATE_KEY=" | cut -d'=' -f2)
SERVER_PUBLIC_KEY=$(echo "$RESULT" | grep "SERVER_PUBLIC_KEY=" | cut -d'=' -f2)
CLIENT_IP=$(echo "$RESULT" | grep "CLIENT_IP=" | cut -d'=' -f2)

if [ -z "$CLIENT_PRIVATE_KEY" ] || [ -z "$SERVER_PUBLIC_KEY" ] || [ -z "$CLIENT_IP" ]; then
    log_error "Failed to generate client config on server."
    echo "Raw output: $RESULT"
    exit 1
fi

log_ok "Peer registered on server (IP: ${CLIENT_IP})"

# Write client config
cat > "$CLIENT_CONF" <<EOF
[Interface]
PrivateKey = ${CLIENT_PRIVATE_KEY}
Address = ${CLIENT_IP}/24
DNS = ${WG_DNS}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
Endpoint = ${SERVER_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF

log_ok "Client config saved to: ${CLIENT_CONF}"
echo ""

# Generate QR code on the server
log_info "Generating QR code..."
vm_ssh "
    cat <<QREOF | qrencode -t ansiutf8
[Interface]
PrivateKey = ${CLIENT_PRIVATE_KEY}
Address = ${CLIENT_IP}/24
DNS = ${WG_DNS}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
Endpoint = ${SERVER_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
QREOF
" || echo "(QR code not available — import the .conf file manually)"

echo ""
echo "=== Quick Start ==="
echo "1. Install WireGuard: https://www.wireguard.com/install/"
echo "2. Import ${CLIENT_CONF} or scan the QR code above"
echo "3. Toggle ON → verify at https://whatismyip.com (should show ${SERVER_IP})"
