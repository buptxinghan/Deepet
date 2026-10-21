#!/usr/bin/env bash
set -euo pipefail
MODE="${1:-run}"
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_CACHE="$HOME/Library/Caches/Deepet/mac-app"
APP_NAME="Deepet"
# Public checkout uses its own bundle identity and settings directory.
# Sign and run on the Mac filesystem; external volumes may add AppleDouble files
# that codesign interprets as executable bundle components.
APP_BUNDLE="$TASK_CACHE/$APP_NAME.app"
NODE_SOURCE="${DEEPET_NODE_BINARY:-$(command -v node || true)}"
if [[ -z "$NODE_SOURCE" || ! -x "$NODE_SOURCE" ]]; then printf '%s\n' "Node.js is required; install Node 24 or set DEEPET_NODE_BINARY."; exit 1; fi
mkdir -p "$TASK_CACHE" "$TASK_ROOT/dist"
if [[ "$MODE" != "--build-only" ]]; then
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
fi
swift build --package-path "$TASK_ROOT/mac-app" --scratch-path "$TASK_CACHE/build"
BUILD_DIR="$(swift build --package-path "$TASK_ROOT/mac-app" --scratch-path "$TASK_CACHE/build" --show-bin-path)"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources/runtime/companion" "$APP_BUNDLE/Contents/Resources/runtime/preview"
cp "$BUILD_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
cp "$NODE_SOURCE" "$APP_BUNDLE/Contents/Resources/runtime/node"
rsync -a --exclude='._*' --exclude='assets' --exclude='tests' --exclude='*-prototype.*' "$TASK_ROOT/companion/" "$APP_BUNDLE/Contents/Resources/runtime/companion/"
mkdir -p "$APP_BUNDLE/Contents/Resources/runtime/integration"
rsync -a --delete --exclude='._*' "$TASK_ROOT/integration/codex-plugin/" "$APP_BUNDLE/Contents/Resources/runtime/integration/codex-plugin/"
cp "$TASK_ROOT/preview/pet-policy.js" "$APP_BUNDLE/Contents/Resources/runtime/preview/pet-policy.js"
mkdir -p "$APP_BUNDLE/Contents/Resources/runtime/companion/assets"
rsync -a --exclude='._*' "$TASK_ROOT/assets/public/" "$APP_BUNDLE/Contents/Resources/runtime/companion/assets/"
if [[ -n "${DEEPET_PET_ASSETS:-}" ]]; then
  rsync -a --exclude='._*' --include='*.gif' --exclude='*' "$DEEPET_PET_ASSETS/" "$APP_BUNDLE/Contents/Resources/runtime/companion/assets/"
fi
xcrun swiftc -O -framework IOKit "$TASK_ROOT/mac-adapter/SystemMetrics.swift" -o "$APP_BUNDLE/Contents/Resources/runtime/companion/system-metrics"
cat > "$APP_BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Deepet</string>
<key>CFBundleIdentifier</key><string>org.deepet.app</string>
<key>CFBundleName</key><string>Deepet</string>
<key>CFBundleDisplayName</key><string>Deepet</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSLocalNetworkUsageDescription</key><string>Deepet通过局域网把本机和服务器状态发送给你的Wi-Fi时钟。</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$APP_BUNDLE/Contents/Resources/runtime/node"
codesign --force --sign - "$APP_BUNDLE/Contents/Resources/runtime/companion/system-metrics"
codesign --force --deep --sign - "$APP_BUNDLE"
ditto -c -k --keepParent --norsrc "$APP_BUNDLE" "$TASK_ROOT/dist/Deepet-0.1.0-macOS-arm64.zip"
case "$MODE" in
  --build-only) printf '%s\n' "$APP_BUNDLE" ;;
  --debug|debug) lldb -- "$APP_BUNDLE/Contents/MacOS/$APP_NAME" ;;
  --logs|logs) /usr/bin/open -n "$APP_BUNDLE"; /usr/bin/log stream --info --style compact --predicate 'process == "Deepet"' ;;
  --telemetry|telemetry) /usr/bin/open -n "$APP_BUNDLE"; /usr/bin/log stream --info --style compact --predicate 'subsystem == "org.deepet.app"' ;;
  --verify|verify) /usr/bin/open -n "$APP_BUNDLE"; sleep 2; pgrep -x "$APP_NAME" >/dev/null ;;
  --snapshot) /usr/bin/open -n "$APP_BUNDLE" --args --snapshot "$TASK_CACHE/native-preview.png"; sleep 2; pgrep -x "$APP_NAME" >/dev/null ;;
  run) /usr/bin/open -n "$APP_BUNDLE" ;;
  *) printf '%s\n' 'usage: build_and_run.sh [--build-only|--verify|--debug|--logs|--telemetry]'; exit 2 ;;
esac
