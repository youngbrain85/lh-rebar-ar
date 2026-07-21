#!/usr/bin/env bash
# Build, archive, export, and upload to TestFlight in one shot.
#
# Usage:
#   scripts/release.sh                     # bumps CURRENT_PROJECT_VERSION by 1
#   scripts/release.sh --version 0.2.0     # also bumps MARKETING_VERSION
#
# Requires the API key at ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8

set -euo pipefail

API_KEY_ID="5J8MLZ4426"
API_ISSUER_ID="40dabd9c-8645-44e4-9754-c6eefe759320"
SCHEME="LHRebarAR"
BUNDLE_ID="kr.lh.rebar-ar"

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

NEW_MARKETING=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) NEW_MARKETING="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

# --- Bump build number in project.yml
CURRENT=$(grep -E "^\s*CURRENT_PROJECT_VERSION:" project.yml | awk '{print $2}' | tr -d '"')
NEXT=$((CURRENT + 1))
echo "Bumping build number: $CURRENT → $NEXT"
sed -i '' "s/CURRENT_PROJECT_VERSION: \"$CURRENT\"/CURRENT_PROJECT_VERSION: \"$NEXT\"/" project.yml

if [[ -n "$NEW_MARKETING" ]]; then
  echo "Setting MARKETING_VERSION: $NEW_MARKETING"
  sed -i '' "s/MARKETING_VERSION: \".*\"/MARKETING_VERSION: \"$NEW_MARKETING\"/" project.yml
  sed -i '' "s/CFBundleShortVersionString: \".*\"/CFBundleShortVersionString: \"$NEW_MARKETING\"/" project.yml
fi
sed -i '' "s/CFBundleVersion: \"$CURRENT\"/CFBundleVersion: \"$NEXT\"/" project.yml

# --- Regenerate xcodeproj
xcodegen generate >/dev/null

# --- Clean + archive
echo "Archiving..."
rm -rf build
xcodebuild \
  -project LHRebarAR.xcodeproj \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/LHRebarAR.xcarchive \
  -allowProvisioningUpdates \
  archive \
  -quiet

# --- Export IPA
# -allowProvisioningUpdates lets the export renew the distribution
# certificate/profile via the Xcode-signed-in account when they expire
# (they lapse yearly with the membership).
echo "Exporting IPA..."
xcodebuild \
  -exportArchive \
  -archivePath build/LHRebarAR.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -quiet

IPA="$PROJECT_ROOT/build/export/$SCHEME.ipa"
echo "IPA: $IPA ($(du -h "$IPA" | cut -f1))"

# --- Upload
echo "Uploading to App Store Connect..."
xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$API_KEY_ID" \
  --apiIssuer "$API_ISSUER_ID"

echo ""
echo "✅ Uploaded build $NEXT. Processing usually takes 5–20 minutes."
echo "   TestFlight testers with auto-distribution will get it when processing ends."
