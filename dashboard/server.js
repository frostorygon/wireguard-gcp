const express = require('express');
const { execSync, exec } = require('child_process');
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
const PORT = process.env.DASHBOARD_PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

// --- Helper: get VM info via gcloud (no SSH needed) ---
function gcloudDescribe() {
    return new Promise((resolve, reject) => {
        const cmd = `gcloud compute instances describe ${VM_NAME} --project=${GCP_PROJECT} --zone=${GCP_ZONE} --format=json --quiet 2>&1`;
        exec(cmd, { timeout: 10000 }, (error, stdout) => {
            if (error) return reject(new Error(stdout || error.message));
            try {
                resolve(JSON.parse(stdout));
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

// GET /api/status — WireGuard status + server uptime
app.get('/api/status', async (req, res) => {
    try {
        const [wgOutput, uptimeOutput] = await Promise.all([
            sshCommand('sudo wg show wg0'),
            sshCommand('uptime -p')
        ]);

        const wg = parseWgShow(wgOutput);
        res.json({
            ok: true,
            server: {
                status: 'running',
                uptime: uptimeOutput,
                interface: wg.interface
            },
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

// GET /api/vm — VM metadata from gcloud
app.get('/api/vm', async (req, res) => {
    try {
        const vm = await gcloudDescribe();
        const ip = vm.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || 'unknown';
        res.json({
            ok: true,
            vm: {
                name: vm.name,
                status: vm.status,
                machineType: vm.machineType?.split('/').pop(),
                zone: vm.zone?.split('/').pop(),
                ip,
                creationTimestamp: vm.creationTimestamp
            }
        });
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

// --- Start server ---
app.listen(PORT, () => {
    console.log(`\n  🛡️  VPN Dashboard running at http://localhost:${PORT}\n`);
    console.log(`  VM: ${VM_NAME} (${GCP_ZONE})`);
    console.log(`  Project: ${GCP_PROJECT}\n`);
});
