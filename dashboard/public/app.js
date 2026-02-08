// ============================================================
// VPN Dashboard — Client-side polling and UI updates
// ============================================================

const POLL_INTERVAL = 30000; // 30 seconds
let pollTimer = null;

// --- DOM refs ---
const $ = (id) => document.getElementById(id);

// --- Fetch helpers ---
async function api(path, method = 'GET') {
    try {
        const res = await fetch(`/api/${path}`, {
            method,
            headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}
        });
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
    // "1 minute, 30 seconds ago" → simplified
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

// --- Fetch VM info (runs once) ---
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
        // Determine handshake status class
        let hsClass = 'handshake-none';
        let hsText = 'Never';
        if (peer.latestHandshake) {
            hsText = timeAgo(peer.latestHandshake);
            // If handshake contains "second" or "minute" → active
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

    // Show loading state
    btn.disabled = true;
    if (spinner) spinner.style.display = 'block';

    const data = await api(`action/${action}`, 'POST');

    // Hide loading state
    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';

    // Show result
    if (action === 'speedtest' && data.ok && data.speedtest) {
        const result = $('speedtestResult');
        result.style.display = 'block';
        $('speedPing').textContent = data.speedtest.ping || '—';
        $('speedDown').textContent = data.speedtest.download || '—';
        $('speedUp').textContent = data.speedtest.upload || '—';
        addLog('Speed test completed', 'success');
    } else if (data.ok) {
        addLog(data.message || `${action} completed`, 'success');
        // Refresh status after restart
        if (action === 'restart') {
            setTimeout(fetchStatus, 3000);
        }
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

    // Keep only last 10 entries
    while (log.children.length > 10) {
        log.removeChild(log.lastChild);
    }
}

// --- Polling loop ---
function startPolling() {
    fetchStatus();
    fetchVmInfo();
    pollTimer = setInterval(fetchStatus, POLL_INTERVAL);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', startPolling);
