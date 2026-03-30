#!/bin/bash
# codesign-mac.sh — Consistently ad-hoc codesign the entire .app bundle
# This fixes the "different Team IDs" crash on macOS 13+ / macOS 26+
#
# macOS requires that every binary in an app bundle be signed by the SAME
# identity. electron-builder's default ad-hoc signing can leave mismatched
# signatures. This script strips all existing signatures and re-signs
# everything from the inside out with a single ad-hoc identity.

set -euo pipefail

APP_PATH="$1"

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "Usage: $0 /path/to/App.app"
  exit 1
fi

echo "==> Codesigning: $APP_PATH"

ENTITLEMENTS="$(dirname "$0")/../build/entitlements.mac.plist"

# Step 1: Find and sign all .dylib files
echo "  Signing .dylib files..."
find "$APP_PATH" -name "*.dylib" -print0 | while IFS= read -r -d '' lib; do
  codesign --force --sign - --timestamp=none "$lib" 2>/dev/null || true
done

# Step 2: Sign all .node native modules (like better-sqlite3)
echo "  Signing .node native modules..."
find "$APP_PATH" -name "*.node" -print0 | while IFS= read -r -d '' mod; do
  codesign --force --sign - --timestamp=none "$mod" 2>/dev/null || true
done

# Step 3: Sign all nested .app bundles (helpers)
echo "  Signing helper apps..."
find "$APP_PATH/Contents/Frameworks" -name "*.app" -maxdepth 2 -print0 2>/dev/null | while IFS= read -r -d '' helper; do
  codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$helper" 2>/dev/null || true
done

# Step 4: Sign all frameworks
echo "  Signing frameworks..."
find "$APP_PATH/Contents/Frameworks" -name "*.framework" -maxdepth 1 -print0 2>/dev/null | while IFS= read -r -d '' fw; do
  codesign --force --sign - --timestamp=none "$fw" 2>/dev/null || true
done

# Step 5: Sign the main app bundle (outermost — must be last)
echo "  Signing main app bundle..."
codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$APP_PATH"

echo "==> Codesigning complete. Verifying..."
codesign --verify --deep --strict "$APP_PATH" && echo "  ✓ Signature valid" || echo "  ✗ Signature verification failed"
