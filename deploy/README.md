# VPS Deployment Guide — Business Accounting Pro

**Domain:** `accounting.rmpgutah.us`
**Stack:** Ubuntu 22.04+ · Nginx · Let's Encrypt SSL · GitHub Actions CI/CD

---

## Architecture

```
GitHub (main branch)
    │
    ├── push to main (landing-page/** changed)
    │
    ▼
GitHub Actions: deploy-vps.yml
    │  rsync
    ▼
VPS /var/www/accounting.rmpgutah.us/
    ├── index.html          ← landing page
    ├── favicon.svg
    └── releases/           ← app download files (optional, manual upload)
         ├── latest-mac.yml
         ├── latest.yml
         └── *.dmg / *.exe
              │
              ▼
         Nginx → https://accounting.rmpgutah.us
```

---

## One-Time VPS Setup

### Step 1 — Provision a VPS

Any Ubuntu 22.04 / 24.04 LTS VPS works:
- DigitalOcean Droplet ($6/mo basic)
- Linode/Akamai, Hetzner, Vultr
- AWS Lightsail

Minimum: **1 vCPU, 512MB RAM, 10GB disk**

### Step 2 — Point DNS to your VPS

In your DNS provider, create:

| Type  | Name                    | Value             | TTL |
|-------|-------------------------|-------------------|-----|
| A     | `accounting.rmpgutah.us` | `<VPS public IP>` | 300 |
| A     | `www.accounting.rmpgutah.us` | `<VPS public IP>` | 300 |

Wait for DNS propagation (a few minutes to 1 hour).

### Step 3 — Run the Setup Script

SSH into your VPS as root and run:

```bash
# Upload the setup script to VPS
scp deploy/setup-vps.sh root@<VPS_IP>:/root/setup-vps.sh

# Run it
ssh root@<VPS_IP> "bash /root/setup-vps.sh"
```

This will:
- Install Nginx, Certbot, rsync
- Configure UFW firewall
- Create the `deploy` user
- Set up the web root at `/var/www/accounting.rmpgutah.us`
- Obtain a Let's Encrypt SSL certificate
- Configure Nginx with HTTPS + gzip + security headers

### Step 4 — Generate a GitHub Actions SSH Key Pair

On your local machine (not the VPS):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy -N ""
```

This creates:
- `~/.ssh/github_actions_deploy`       ← **private key** → goes into GitHub secret
- `~/.ssh/github_actions_deploy.pub`   ← **public key** → goes on the VPS

**Add the public key to the VPS:**
```bash
ssh root@<VPS_IP> \
  "cat >> /home/deploy/.ssh/authorized_keys" \
  < ~/.ssh/github_actions_deploy.pub
```

### Step 5 — Add GitHub Repository Secrets

In your GitHub repo → **Settings** → **Secrets and variables** → **Actions**:

| Secret Name | Value |
|-------------|-------|
| `VPS_HOST`  | Your VPS IP or hostname (e.g. `143.110.xxx.xxx`) |
| `VPS_USER`  | `deploy` |
| `VPS_SSH_KEY` | Contents of `~/.ssh/github_actions_deploy` (private key, including `-----BEGIN...`) |

### Step 6 — Allow deploy user to reload Nginx (no password)

SSH into the VPS as root and add the sudoers rule:

```bash
echo "deploy ALL=(root) NOPASSWD: /usr/sbin/nginx" > /etc/sudoers.d/deploy-nginx
chmod 440 /etc/sudoers.d/deploy-nginx
visudo -c  # verify no syntax errors
```

---

## Deploying

### Automatic (every push to main)

The workflow `deploy-vps.yml` fires automatically when any of these change:
- `landing-page/**`
- `deploy/nginx.conf`
- `.github/workflows/deploy-vps.yml`

### Manual trigger

GitHub → **Actions** → **Deploy to VPS** → **Run workflow**

---

## Hosting Release Files (optional)

To host app binaries for download (replaces GitHub Releases):

1. Build the app locally:
   ```bash
   npm run dist
   ```

2. Copy release files to the VPS:
   ```bash
   scp release/*.dmg release/*.exe release/latest*.yml \
     deploy@<VPS_IP>:/var/www/accounting.rmpgutah.us/releases/
   ```

3. Update `electron-builder.yml` to point to your VPS instead of GitHub:
   ```yaml
   publish:
     provider: generic
     url: https://accounting.rmpgutah.us/releases/
   ```

---

## SSL Certificate Renewal

Certbot auto-renews every 60 days via cron (`/etc/cron.d/certbot-renew`). No manual action needed.

To test renewal manually:
```bash
ssh root@<VPS_IP> "certbot renew --dry-run"
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Nginx 502/503 | `ssh root@<VPS> "systemctl status nginx"` |
| SSL expired | `ssh root@<VPS> "certbot renew"` |
| Deploy fails "Permission denied" | Verify SSH key in GitHub secrets and `authorized_keys` |
| Site shows old content | Nginx caching: `curl -I https://accounting.rmpgutah.us` should show `Cache-Control: public` |
