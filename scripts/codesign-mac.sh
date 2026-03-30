#!/bin/bash
# codesign-mac.sh — Consistently ad-hoc codesign the entire .app bundle
#
# Fixes the "different Team IDs" crash on macOS 13+ / macOS 26+.
# macOS requires EVERY binary in a bundle to be signed by the SAME identity.
# This script strips ALL existing signatures and re-signs inside-out with
# a single ad-hoc identity ("-").

set -euo pipefail

APP_PATH="$1"

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "Usage: $0 /path/to/App.app"
  exit 1
fi

echo "==> Ad-hoc codesigning: $APP_PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTITLEMENTS="$SCRIPT_DIR/../build/entitlements.mac.plist"

if [ ! -f "$ENTITLEMENTS" ]; then
  echo "ERROR: Entitlements file not found at $ENTITLEMENTS"
  exit 1
fi

echo "  Using entitlements: $ENTITLEMENTS"

# Step 1: Strip ALL existing signatures first (clean slate)
echo "  Stripping existing signatures..."
find "$APP_PATH" -type f \( -name "*.dylib" -o -name "*.node" -o -name "*.so" \) -print0 | while IFS= read -r -d '' f; do
  codesign --remove-signature "$f" 2>/dev/null || true
done

# Strip framework signatures
find "$APP_PATH/Contents/Frameworks" -maxdepth 2 -name "*.framework" -print0 2>/dev/null | while IFS= read -r -d '' fw; do
  codesign --remove-signature "$fw" 2>/dev/null || true
done

# Strip helper app signatures
find "$APP_PATH/Contents/Frameworks" -maxdepth 3 -name "*.app" -print0 2>/dev/null | while IFS= read -r -d '' helper; do
  codesign --remove-signature "$helper" 2>/dev/null || true
done

# Strip main app signature
codesign --remove-signature "$APP_PATH" 2>/dev/null || true

# Step 2: Sign all .dylib files (innermost first)
echo "  Signing .dylib files..."
find "$APP_PATH" -name "*.dylib" -print0 | while IFS= read -r -d '' lib; do
  echo "    $lib"
  codesign --force --sign - --timestamp=none "$lib"
done

# Step 3: Sign all .node native modules (better-sqlite3, etc.)
echo "  Signing .node native modules..."
find "$APP_PATH" -name "*.node" -print0 | while IFS= read -r -d '' mod; do
  echo "    $mod"
  codesign --force --sign - --timestamp=none "$mod"
done

# Step 4: Sign all .so files
echo "  Signing .so files..."
find "$APP_PATH" -name "*.so" -print0 | while IFS= read -r -d '' so; do
  echo "    $so"
  codesign --force --sign - --timestamp=none "$so"
done

# Step 5: Sign Electron Framework specifically (the versioned bundle)
echo "  Signing Electron Framework..."
EF_PATH="$APP_PATH/Contents/Frameworks/Electron Framework.framework"
if [ -d "$EF_PATH" ]; then
  # Sign the actual binary inside Versions/A/ first
  if [ -f "$EF_PATH/Versions/A/Electron Framework" ]; then
    codesign --force --sign - --timestamp=none "$EF_PATH/Versions/A/Electron Framework"
  fi
  # Then sign the framework bundle
  codesign --force --sign - --timestamp=none "$EF_PATH"
fi

# Step 6: Sign all other frameworks
echo "  Signing other frameworks..."
find "$APP_PATH/Contents/Frameworks" -maxdepth 1 -name "*.framework" ! -name "Electron Framework.framework" -print0 2>/dev/null | while IFS= read -r -d '' fw; do
  echo "    $fw"
  codesign --force --sign - --timestamp=none "$fw"
done

# Step 7: Sign helper apps (GPU, renderer, plugin helpers)
echo "  Signing helper apps..."
find "$APP_PATH/Contents/Frameworks" -maxdepth 2 -name "*.app" -print0 2>/dev/null | while IFS= read -r -d '' helper; do
  echo "    $helper"
  # Sign the helper's main binary first
  HELPER_BIN="$helper/Contents/MacOS/$(basename "${helper%.app}")"
  if [ -f "$HELPER_BIN" ]; then
    codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$HELPER_BIN"
  fi
  # Then the helper bundle
  codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$helper"
done

# Step 8: Sign the main executable
echo "  Signing main executable..."
MAIN_BIN="$APP_PATH/Contents/MacOS/Business Accounting Pro"
if [ -f "$MAIN_BIN" ]; then
  codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$MAIN_BIN"
fi

# Step 9: Sign the outermost app bundle (must be last)
echo "  Signing main app bundle..."
codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$APP_PATH"

# Step 10: Verify
echo "==> Verifying signature..."
if codesign --verify --deep --strict "$APP_PATH" 2>&1; then
  echo "  ✓ Signature valid — all binaries share the same identity"
else
  echo "  ✗ Verification failed — dumping details:"
  codesign -dvvv "$APP_PATH" 2>&1 || true
  exit 1
fi
