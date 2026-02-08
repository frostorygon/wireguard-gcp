# 🔒 WireGuard VPN on Google Cloud

One-command deploy of a personal WireGuard VPN on Google Cloud Platform.

**Fast, private, yours.** No third-party VPN provider, no data harvesting, no speed throttling.

## Features

- 🚀 **One-command deploy** — `./bin/deploy.sh` sets up everything
- 🔐 **WireGuard protocol** — fastest VPN protocol, built into the Linux kernel (~3% overhead)
- 📱 **Multi-device** — generate configs for phone, laptop, tablet with QR codes
- 🛠️ **Full management CLI** — status, restart, speed test, logs, add/remove clients
- 💸 **Cheap** — runs on GCP free tier or ~$4/month for optimal regions
- 🧹 **Clean teardown** — one command to destroy everything and stop billing

## Architecture

```
┌──────────────┐       WireGuard (UDP 51820)       ┌────────────────────┐
│  Your Device │ ◄────────────────────────────────► │  GCE VM (e2-micro) │
│  Phone / PC  │        Encrypted Tunnel            │  Ubuntu + WireGuard│
└──────────────┘                                    └────────┬───────────┘
                                                             │
                                                        Internet → 🌍
```

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud` CLI)
- A GCP account with billing enabled (free trial gives $300 credits)
- Bash shell (Git Bash on Windows, or native on Mac/Linux)

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/frostorygon/wireguard-gcp.git
cd wireguard-gcp

# Copy the config template and fill in your GCP details
cp config/.env.example config/.env
# Edit config/.env with your GCP project ID, region, etc.
```

### 2. Authenticate with GCP

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### 3. Deploy

```bash
./bin/deploy.sh
```

This will:
1. Create a firewall rule allowing WireGuard traffic (UDP 51820)
2. Spin up an `e2-micro` VM with Ubuntu 24.04
3. Install and configure WireGuard on the server
4. Generate your first client config with a QR code

### 4. Connect

1. Install the [WireGuard app](https://www.wireguard.com/install/) on your device
2. Import `clients/default.conf` or scan the QR code
3. Toggle the VPN ON
4. Verify at [whatismyip.com](https://whatismyip.com) — should show your server's IP

## Adding More Devices

```bash
./bin/generate-client.sh phone
./bin/generate-client.sh laptop
./bin/generate-client.sh tablet
```

Each generates a `.conf` file in `clients/` and a QR code for mobile devices.

## Management

```bash
./bin/vpn-manage.sh status      # Server health + connected peers
./bin/vpn-manage.sh list        # List all client configs
./bin/vpn-manage.sh remove phone  # Remove a client
./bin/vpn-manage.sh restart     # Restart WireGuard
./bin/vpn-manage.sh speed       # Run speed test on server
./bin/vpn-manage.sh logs        # View WireGuard logs
./bin/vpn-manage.sh ip          # Show server external IP
./bin/vpn-manage.sh ssh         # SSH into the server
```

## Configuration

All settings live in `config/.env` (never committed to git):

```env
# GCP Settings
GCP_PROJECT=your-project-id
GCP_REGION=asia-southeast1
GCP_ZONE=asia-southeast1-b

# VM Settings
VM_NAME=wireguard-vpn
MACHINE_TYPE=e2-micro

# WireGuard Settings
WG_PORT=51820
WG_SUBNET=10.0.0
WG_DNS="1.1.1.1, 8.8.8.8"
```

### Region Selection

| Region | Location | Latency (SEA) | Free Tier? | Monthly Cost |
|---|---|---|---|---|
| `asia-southeast1` | Singapore | ~30ms | ❌ | ~$4.28 |
| `asia-east1` | Taiwan | ~50ms | ❌ | ~$4.28 |
| `us-west1` | Oregon | ~150ms | ✅ | **$0** |
| `us-central1` | Iowa | ~180ms | ✅ | **$0** |
| `europe-west1` | Belgium | ~200ms | ✅ | **$0** |

## Teardown

```bash
./bin/teardown.sh          # Interactive confirm
./bin/teardown.sh --force  # Skip confirmation
```

Destroys the VM, firewall rule, and local client configs. No more charges.

## Project Structure

```
├── bin/                       # CLI scripts (user-facing)
│   ├── lib.sh                 # Shared config loader & utilities
│   ├── deploy.sh              # Full deployment orchestrator
│   ├── generate-client.sh     # Create new client configs
│   ├── vpn-manage.sh          # Management commands
│   └── teardown.sh            # Destroy all resources
├── server/                    # Server-side scripts (run on VM)
│   └── setup-server.sh        # WireGuard install & config
├── config/                    # Configuration
│   ├── .env.example           # Template (committed)
│   └── .env                   # Your secrets (gitignored)
├── clients/                   # Generated .conf files (gitignored)
├── .gitignore
├── LICENSE
└── README.md
```

## Security

- **No secrets in git** — `.env` and client configs are gitignored
- **SSH keys excluded** — `*.key`, `*.pem` patterns blocked
- **WireGuard encryption** — ChaCha20 + Curve25519 + BLAKE2s
- **Minimal attack surface** — only UDP 51820 is exposed
- **No root SSH** — GCP OS Login handles authentication

## License

[MIT](LICENSE)
