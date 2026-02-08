// ============================================================
// VPN Dashboard — Client-side polling, UI updates, Add Client
// ============================================================

const POLL_INTERVAL = 30000;
let pollTimer = null;
let lastConfig = ''; // Holds most recent generated config for copy

const $ = (id) => document.getElementById(id);

// --- Fetch helpers ---
async function api(path, method = 'GET', body = null) {
    try {
        const opts = { method, headers: {} };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(`/api/${path}`, opts);
        return await res.json();
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// --- Format helpers ---
function truncateKey(key) {
    if (!key || key.length < 12) return key || '—';
    return key.slice(0, 8) + '…' + key.slice(-4);
}

function timeAgo(text) {
    if (!text) return '—';
    return text.replace(/ ago$/, '');
}

// --- Update status UI ---
async function fetchStatus() {
    const data = await api('status');
    const badge = $('statusBadge');
    const badgeText = badge.querySelector('.status-text');

    if (data.ok && data.server.status === 'running') {
        badge.className = 'status-badge online';
        badgeText.textContent = 'Online';
        $('uptime').textContent = data.server.uptime?.replace('up ', '') || '—';
        $('peerCount').textContent = data.peers.length;
        $('peerBadge').textContent = data.peers.length;
        renderPeers(data.peers);
    } else {
        badge.className = 'status-badge offline';
        badgeText.textContent = 'Offline';
        $('uptime').textContent = '—';
        $('peerCount').textContent = '0';
        $('peerBadge').textContent = '0';
        renderPeers([]);
    }

    $('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// --- Fetch VM info (runs once, cached server-side) ---
async function fetchVmInfo() {
    const data = await api('vm');
    if (data.ok && data.vm) {
        $('serverIp').textContent = data.vm.ip || '—';
        $('machineType').textContent = data.vm.machineType || '—';
        $('region').textContent = data.vm.zone || '—';
    }
}

// --- Render peer table ---
function renderPeers(peers) {
    const tbody = $('peersBody');

    if (!peers || peers.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No peers connected</td></tr>';
        return;
    }

    tbody.innerHTML = peers.map(peer => {
        let hsClass = 'handshake-none';
        let hsText = 'Never';
        if (peer.latestHandshake) {
            hsText = timeAgo(peer.latestHandshake);
            if (/second|minute/.test(peer.latestHandshake)) {
                hsClass = 'handshake-active';
            } else {
                hsClass = 'handshake-stale';
            }
        }

        return `
      <tr>
        <td><span class="peer-key" title="${peer.publicKey || ''}">${truncateKey(peer.publicKey)}</span></td>
        <td>${peer.allowedIPs || '—'}</td>
        <td><span class="${hsClass}">${hsText}</span></td>
        <td>${peer.transferRx || '—'}</td>
        <td>${peer.transferTx || '—'}</td>
      </tr>
    `;
    }).join('');
}

// --- Quick actions ---
async function doAction(action) {
    const btnId = action === 'restart' ? 'btnRestart' : 'btnSpeedtest';
    const btn = $(btnId);
    const spinner = btn.querySelector('.action-spinner');

    btn.disabled = true;
    if (spinner) spinner.style.display = 'block';

    const data = await api(`action/${action}`, 'POST');

    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';

    if (action === 'speedtest' && data.ok && data.speedtest) {
        $('speedtestResult').style.display = 'block';
        $('speedPing').textContent = data.speedtest.ping || '—';
        $('speedDown').textContent = data.speedtest.download || '—';
        $('speedUp').textContent = data.speedtest.upload || '—';
        addLog('Speed test completed', 'success');
    } else if (data.ok) {
        addLog(data.message || `${action} completed`, 'success');
        if (action === 'restart') setTimeout(fetchStatus, 3000);
    } else {
        addLog(`Error: ${data.error || 'Unknown error'}`, 'error');
    }
}

// --- Action log ---
function addLog(message, type = 'success') {
    const log = $('actionLog');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.prepend(entry);
    while (log.children.length > 10) log.removeChild(log.lastChild);
}

// ============================================================
// Add Client — Modal + QR Code
// ============================================================

function openAddClient() {
    const modal = $('addClientModal');
    modal.classList.add('open');
    // Reset to step 1
    $('stepName').style.display = 'block';
    $('stepResult').style.display = 'none';
    $('clientName').value = '';
    $('clientName').focus();
}

function closeModal() {
    $('addClientModal').classList.remove('open');
    // Refresh peer list after adding
    setTimeout(fetchStatus, 1000);
}

async function generateClient() {
    const nameInput = $('clientName');
    const name = nameInput.value.trim();

    if (!name || !/^[a-zA-Z0-9-]{1,20}$/.test(name)) {
        nameInput.style.borderColor = 'var(--danger)';
        return;
    }
    nameInput.style.borderColor = '';

    const btn = $('btnGenerate');
    const spinner = $('generateSpinner');
    btn.disabled = true;
    spinner.style.display = 'inline-block';

    const data = await api('client/add', 'POST', { name });

    btn.disabled = false;
    spinner.style.display = 'none';

    if (!data.ok) {
        addLog(`Add client failed: ${data.error}`, 'error');
        nameInput.style.borderColor = 'var(--danger)';
        return;
    }

    lastConfig = data.config;

    // Render QR code on canvas
    const canvas = $('qrCanvas');
    try {
        await QRCode.toCanvas(canvas, data.config, {
            width: 300,
            margin: 2,
            color: { dark: '#ffffff', light: '#0c1016' }
        });
    } catch (err) {
        console.error('QR generation failed:', err);
    }

    // Show config text
    $('configText').textContent = data.config;

    // Switch to result step
    $('stepName').style.display = 'none';
    $('stepResult').style.display = 'block';

    addLog(`Device "${name}" added successfully`, 'success');
}

function copyConfig() {
    if (!lastConfig) return;
    navigator.clipboard.writeText(lastConfig).then(() => {
        addLog('Config copied to clipboard', 'success');
    }).catch(() => {
        // Fallback: select the text
        const pre = $('configText');
        const range = document.createRange();
        range.selectNodeContents(pre);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    });
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'addClientModal') closeModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// --- Polling loop ---
function startPolling() {
    fetchStatus();
    fetchVmInfo();
    pollTimer = setInterval(fetchStatus, POLL_INTERVAL);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', startPolling);
