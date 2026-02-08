#!/bin/bash
# vpn-manage.sh — Manage your WireGuard VPN
# Usage: ./bin/vpn-manage.sh <command> [args]
source "$(dirname "$0")/lib.sh"
validate_config

# --- Functions ---
show_help() {
    echo "WireGuard VPN Manager"
    echo ""
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  status    Show WireGuard status and connected peers"
    echo "  list      List all client configs"
    echo "  remove    Remove a client: $0 remove <name>"
    echo "  restart   Restart WireGuard on server"
    echo "  logs      Show recent WireGuard logs"
    echo "  ip        Show server's external IP"
    echo "  ssh       Open SSH session to the server"
    echo "  speed     Run a speed test on the server"
    echo ""
}

cmd_status() {
    echo "=== WireGuard Server Status ==="
    echo ""

    VM_STATUS=$(gcloud compute instances describe "$VM_NAME" \
        --project="$GCP_PROJECT" --zone="$GCP_ZONE" \
        --format="get(status)" 2>/dev/null || echo "NOT_FOUND")

    if [ "$VM_STATUS" != "RUNNING" ]; then
        log_error "VM is ${VM_STATUS}"
        return 1
    fi

    log_ok "VM is RUNNING"
    echo ""
    vm_ssh "sudo wg show"
    echo ""
    echo "=== Server Resources ==="
    vm_ssh "echo 'CPU:' && uptime && echo '' && echo 'Memory:' && free -h | head -2 && echo '' && echo 'Disk:' && df -h / | tail -1"
}

cmd_list() {
    echo "=== Client Configs ==="
    echo ""
    if [ -d "$CLIENT_DIR" ] && ls "$CLIENT_DIR"/*.conf &>/dev/null; then
        for conf in "$CLIENT_DIR"/*.conf; do
            name=$(basename "$conf" .conf)
            ip=$(grep "Address" "$conf" | cut -d'=' -f2 | tr -d ' ')
            echo "  📱 ${name} — ${ip} — ${conf}"
        done
    else
        echo "  No clients configured yet."
        echo "  Run: ./bin/generate-client.sh <name>"
    fi
    echo ""
}

cmd_remove() {
    local name="$1"
    local conf="${CLIENT_DIR}/${name}.conf"

    if [ ! -f "$conf" ]; then
        log_error "Client '${name}' not found at ${conf}"
        exit 1
    fi

    log_info "Removing client: ${name}"
    vm_ssh "
        sudo cp /etc/wireguard/wg0.conf /etc/wireguard/wg0.conf.bak
        sudo python3 -c \"
import re
with open('/etc/wireguard/wg0.conf', 'r') as f:
    content = f.read()
pattern = r'\n\[Peer\]\n# ${name}\n[^\[]*'
content = re.sub(pattern, '', content)
with open('/etc/wireguard/wg0.conf', 'w') as f:
    f.write(content)
\"
        sudo systemctl restart wg-quick@wg0
    "
    rm -f "$conf"
    log_ok "Client '${name}' removed"
}

cmd_restart() {
    log_info "Restarting WireGuard on server..."
    vm_ssh "sudo systemctl restart wg-quick@wg0 && echo 'Restarted' && sudo wg show"
}

cmd_logs() {
    echo "=== Recent WireGuard Logs ==="
    vm_ssh "sudo journalctl -u wg-quick@wg0 --no-pager -n 30"
}

cmd_ip() {
    echo "Server IP: $(vm_ip)"
}

cmd_ssh() {
    log_info "Opening SSH session to ${VM_NAME}..."
    gcloud compute ssh "$VM_NAME" --project="$GCP_PROJECT" --zone="$GCP_ZONE"
}

cmd_speed() {
    log_info "Running speed test on server..."
    vm_ssh "
        if ! command -v speedtest-cli &>/dev/null; then
            sudo apt-get install -y -qq speedtest-cli 2>/dev/null
        fi
        speedtest-cli --simple
    "
}

# --- Main ---
if [ $# -lt 1 ]; then
    show_help
    exit 0
fi

COMMAND="$1"
shift

case "$COMMAND" in
    status)  cmd_status ;;
    list)    cmd_list ;;
    remove)
        [ $# -lt 1 ] && { echo "Usage: $0 remove <client-name>"; exit 1; }
        cmd_remove "$1"
        ;;
    restart) cmd_restart ;;
    logs)    cmd_logs ;;
    ip)      cmd_ip ;;
    ssh)     cmd_ssh ;;
    speed)   cmd_speed ;;
    *)       echo "Unknown command: ${COMMAND}"; show_help; exit 1 ;;
esac
