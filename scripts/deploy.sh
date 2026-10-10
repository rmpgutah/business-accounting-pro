#!/usr/bin/env bash
# deploy.sh — Push to GitHub
set -e

echo "==> Pushing to GitHub..."
git push origin main

echo "==> Deploy complete."
