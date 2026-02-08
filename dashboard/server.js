const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// --- Load config from ../config/.env ---
const envPath = path.join(__dirname, '..', 'config', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const [key, ...vals] = line.split('=');
        if (key && vals.length) {
            process.env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
        }
    });
}

const GCP_PROJECT = process.env.GCP_PROJECT;
const GCP_ZONE = process.env.GCP_ZONE;
const VM_NAME = process.env.VM_NAME || 'wireguard-vpn';
const WG_PORT = process.env.WG_PORT || '51820';
const WG_SUBNET = process.env.WG_SUBNET || '10.0.0';
const PORT = process.env.DASHBOARD_PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- VM info cache (IP, zone, machine type don't change) ---
let vmCache = null;

// --- Helper: run command on VM via gcloud SSH ---
function sshCommand(cmd, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const fullCmd = `gcloud compute ssh ${VM_NAME} --project=${GCP_PROJECT} --zone=${GCP_ZONE} --command="${cmd.replace(/"/g, '\\"')}" --quiet 2>&1`;

        exec(fullCmd, { timeout }, (error, stdout, stderr) => {
            if (error && error.killed) {
                reject(new Error('Command timed out'));
            } else if (error) {
                reject(new Error(stdout || stderr || error.message));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

// --- Helper: run a bash script on the VM via SCP (avoids Windows cmd.exe escaping) ---
function sshScript(scriptContent, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const tmpFile = path.join(__dirname, `.tmp-script-${Date.now()}.sh`);
        fs.writeFileSync(tmpFile, scriptContent);

        const scpCmd = `gcloud compute scp "${tmpFile}" ${VM_NAME}:/tmp/_dash_script.sh --project=${GCP_PROJECT} --zone=${GCP_ZONE} --quiet 2>&1`;

        exec(scpCmd, { timeout: 15000 }, (scpErr, scpOut) => {
            try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

            if (scpErr) return reject(new Error('SCP failed: ' + (scpOut || scpErr.message)));

            const runCmd = `gcloud compute ssh ${VM_NAME} --project=${GCP_PROJECT} --zone=${GCP_ZONE} --command="bash /tmp/_dash_script.sh && rm -f /tmp/_dash_script.sh" --quiet 2>&1`;

            exec(runCmd, { timeout }, (error, stdout) => {
                if (error && error.killed) reject(new Error('Command timed out'));
                else if (error) reject(new Error(stdout || error.message));
                else resolve(stdout.trim());
            });
        });
    });
}

// --- Helper: get VM info via gcloud (cached) ---
async function getVmInfo() {
    if (vmCache) return vmCache;

    return new Promise((resolve, reject) => {
        const cmd = `gcloud compute instances describe ${VM_NAME} --project=${GCP_PROJECT} --zone=${GCP_ZONE} --format=json --quiet 2>&1`;
        exec(cmd, { timeout: 10000 }, (error, stdout) => {
            if (error) return reject(new Error(stdout || error.message));
            try {
                const vm = JSON.parse(stdout);
                vmCache = {
                    name: vm.name,
                    status: vm.status,
                    machineType: vm.machineType?.split('/').pop(),
                    zone: vm.zone?.split('/').pop(),
                    ip: vm.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || 'unknown',
                    creationTimestamp: vm.creationTimestamp
                };
                resolve(vmCache);
            } catch (e) {
                reject(new Error('Failed to parse VM info'));
            }
        });
    });
}

// --- Parse `wg show wg0` output ---
function parseWgShow(output) {
    const result = { interface: {}, peers: [] };
    let currentPeer = null;

    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('interface:')) {
            result.interface.name = trimmed.split(':')[1]?.trim();
        } else if (trimmed.startsWith('public key:')) {
            if (currentPeer) result.peers.push(currentPeer);
            currentPeer = { publicKey: trimmed.split(':').slice(1).join(':').trim() };
        } else if (trimmed.startsWith('listening port:')) {
            result.interface.listenPort = trimmed.split(':').slice(1).join(':').trim();
        } else if (currentPeer) {
            if (trimmed.startsWith('endpoint:')) {
                currentPeer.endpoint = trimmed.split(':').slice(1).join(':').trim();
            } else if (trimmed.startsWith('allowed ips:')) {
                currentPeer.allowedIPs = trimmed.split(':').slice(1).join(':').trim();
            } else if (trimmed.startsWith('latest handshake:')) {
                currentPeer.latestHandshake = trimmed.split(':').slice(1).join(':').trim();
            } else if (trimmed.startsWith('transfer:')) {
                const transfer = trimmed.split(':').slice(1).join(':').trim();
                const parts = transfer.split(',');
                if (parts.length === 2) {
                    currentPeer.transferRx = parts[0].trim().replace(' received', '');
                    currentPeer.transferTx = parts[1].trim().replace(' sent', '');
                }
            }
        }
    }
    if (currentPeer) result.peers.push(currentPeer);
    return result;
}

// ============================================================
// API Routes
// ============================================================

// GET /api/status — WireGuard status + uptime in ONE SSH call
app.get('/api/status', async (req, res) => {
    try {
        const output = await sshCommand(
            'echo "===WG===" && sudo wg show wg0 && echo "===UPTIME===" && uptime -p'
        );

        const wgPart = output.split('===UPTIME===')[0].replace('===WG===', '').trim();
        const uptimePart = output.split('===UPTIME===')[1]?.trim() || '—';

        const wg = parseWgShow(wgPart);
        res.json({
            ok: true,
            server: { status: 'running', uptime: uptimePart, interface: wg.interface },
            peers: wg.peers,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.json({
            ok: false,
            server: { status: 'unreachable' },
            peers: [],
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

// GET /api/vm — VM metadata (cached after first call)
app.get('/api/vm', async (req, res) => {
    try {
        const vm = await getVmInfo();
        res.json({ ok: true, vm });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// POST /api/action/restart — Restart WireGuard
app.post('/api/action/restart', async (req, res) => {
    try {
        await sshCommand('sudo systemctl restart wg-quick@wg0', 20000);
        res.json({ ok: true, message: 'WireGuard restarted successfully' });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// POST /api/action/speedtest — Run speed test
app.post('/api/action/speedtest', async (req, res) => {
    try {
        const output = await sshCommand('speedtest-cli --simple 2>&1 || echo "speedtest-cli not installed"', 60000);
        const lines = output.split('\n');
        const result = {};
        lines.forEach(l => {
            if (l.startsWith('Ping:')) result.ping = l.split(':')[1]?.trim();
            if (l.startsWith('Download:')) result.download = l.split(':')[1]?.trim();
            if (l.startsWith('Upload:')) result.upload = l.split(':')[1]?.trim();
        });
        res.json({ ok: true, speedtest: result, raw: output });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// POST /api/client/add — Generate a new client config
app.post('/api/client/add', async (req, res) => {
    const { name } = req.body;

    if (!name || !/^[a-zA-Z0-9-]{1,20}$/.test(name)) {
        return res.json({ ok: false, error: 'Invalid name. Use letters, numbers, and dashes only (max 20 chars).' });
    }

    try {
        const vm = await getVmInfo();
        const serverIP = vm.ip;

        // Build a self-contained bash script (SCP'd to avoid Windows escaping)
        const script = `#!/bin/bash
set -e

SERVER_PUB=$(sudo cat /etc/wireguard/server_public.key 2>/dev/null || sudo wg show wg0 public-key)

# Find next available IP
USED_IPS=$(sudo grep -oP '${WG_SUBNET}\\.\\K[0-9]+' /etc/wireguard/wg0.conf | sort -n)
NEXT_IP=2
for ip in $USED_IPS; do
  if [ "$ip" -ge "$NEXT_IP" ]; then
    NEXT_IP=$((ip + 1))
  fi
done
if [ "$NEXT_IP" -gt 254 ]; then
  echo "ERROR:No available IPs"
  exit 1
fi

# Generate client keypair
CLIENT_PRIV=$(wg genkey)
CLIENT_PUB=$(echo "$CLIENT_PRIV" | wg pubkey)

# Backup and add peer
sudo cp /etc/wireguard/wg0.conf /etc/wireguard/wg0.conf.bak
echo "" | sudo tee -a /etc/wireguard/wg0.conf > /dev/null
echo "# Client: ${name}" | sudo tee -a /etc/wireguard/wg0.conf > /dev/null
echo "[Peer]" | sudo tee -a /etc/wireguard/wg0.conf > /dev/null
echo "PublicKey = $CLIENT_PUB" | sudo tee -a /etc/wireguard/wg0.conf > /dev/null
echo "AllowedIPs = ${WG_SUBNET}.$NEXT_IP/32" | sudo tee -a /etc/wireguard/wg0.conf > /dev/null

# Restart to apply
sudo systemctl restart wg-quick@wg0

# Output the client config
echo "===CONFIG==="
echo "[Interface]"
echo "PrivateKey = $CLIENT_PRIV"
echo "Address = ${WG_SUBNET}.$NEXT_IP/24"
echo "DNS = 1.1.1.1, 8.8.8.8"
echo ""
echo "[Peer]"
echo "PublicKey = $SERVER_PUB"
echo "Endpoint = ${serverIP}:${WG_PORT}"
echo "AllowedIPs = 0.0.0.0/0"
echo "PersistentKeepalive = 25"
echo "===END==="

rm -f /tmp/client_*.conf /tmp/vpn-qr-*.png 2>/dev/null
`;

        const output = await sshScript(script, 45000);

        const configMatch = output.match(/===CONFIG===([\s\S]*?)===END===/);
        if (!configMatch) {
            return res.json({ ok: false, error: 'Failed to generate config. Output: ' + output.slice(0, 200) });
        }

        const config = configMatch[1].trim();

        // Save config locally
        const clientsDir = path.join(__dirname, '..', 'clients');
        if (!fs.existsSync(clientsDir)) fs.mkdirSync(clientsDir, { recursive: true });
        fs.writeFileSync(path.join(clientsDir, `${name}.conf`), config + '\n');

        res.json({ ok: true, name, config });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// --- Start server ---
app.listen(PORT, () => {
    console.log(`\n  🛡️  VPN Dashboard running at http://localhost:${PORT}\n`);
    console.log(`  VM: ${VM_NAME} (${GCP_ZONE})`);
    console.log(`  Project: ${GCP_PROJECT}\n`);
});
