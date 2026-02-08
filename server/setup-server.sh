#!/bin/bash
# setup-server.sh — Runs ON the GCE VM to install and configure WireGuard
# This script is copied to the VM and executed by deploy.sh
set -euo pipefail

echo "=== WireGuard Server Setup ==="

# Install WireGuard and QR code generator
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq wireguard qrencode > /dev/null 2>&1

echo "[✓] WireGuard installed"

# Generate server keypair
sudo mkdir -p /etc/wireguard
cd /etc/wireguard

if [ ! -f server_private.key ]; then
    wg genkey | sudo tee server_private.key > /dev/null
    sudo chmod 600 server_private.key
    sudo cat server_private.key | wg pubkey | sudo tee server_public.key > /dev/null
    echo "[✓] Server keypair generated"
else
    echo "[✓] Server keypair already exists"
fi

SERVER_PRIVATE_KEY=$(sudo cat /etc/wireguard/server_private.key)
SERVER_PUBLIC_KEY=$(sudo cat /etc/wireguard/server_public.key)

# Get the primary network interface
SERVER_IFACE=$(ip route show default | awk '{print $5}' | head -1)

# Create WireGuard config
sudo tee /etc/wireguard/wg0.conf > /dev/null <<EOF
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = ${SERVER_PRIVATE_KEY}

# NAT and forwarding rules
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${SERVER_IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${SERVER_IFACE} -j MASQUERADE
EOF

sudo chmod 600 /etc/wireguard/wg0.conf

echo "[✓] WireGuard config written"

# Enable IP forwarding (persist across reboots)
sudo sysctl -w net.ipv4.ip_forward=1 > /dev/null
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf > /dev/null 2>&1

echo "[✓] IP forwarding enabled"

# Start WireGuard
sudo systemctl enable wg-quick@wg0 > /dev/null 2>&1
sudo systemctl start wg-quick@wg0 2>/dev/null || sudo wg-quick up wg0 2>/dev/null || true

echo "[✓] WireGuard service started"
echo ""
echo "SERVER_PUBLIC_KEY=${SERVER_PUBLIC_KEY}"
echo ""
echo "=== Server setup complete ==="
