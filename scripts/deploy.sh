#!/usr/bin/env bash
# deploy.sh — Push to GitHub and deploy sync server to VPS in one command
set -e

SSH_KEY="$HOME/.ssh/id_ed25519_deploy"
VPS="root@194.113.64.90"

echo "==> Pushing to GitHub..."
git push origin main

echo "==> Syncing server to VPS..."
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.env' \
  --exclude='data' \
  -e "ssh -i $SSH_KEY" \
  server/ "$VPS:/opt/bap-server/"

echo "==> Building and restarting server on VPS..."
ssh -i "$SSH_KEY" "$VPS" "cd /opt/bap-server && npm install --production && npm run build && (pm2 restart bap-server --update-env 2>/dev/null || pm2 start dist/index.js --name bap-server --cwd /opt/bap-server --restart-delay 3000 --max-restarts 5) && pm2 save"

echo "==> Deploy complete."
