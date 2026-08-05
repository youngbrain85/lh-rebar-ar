#!/usr/bin/env python3
"""Query App Store Connect for recent TestFlight build processing states.

Usage:  .venv/bin/python scripts/build_status.py [target_build_number]

Env: optional BUNDLE_ID (default kr.lh.rebar-ar — the research app; pass
BUNDLE_ID=kr.lh.rebar-lh to poll the LH app once its ASC record exists).

Reads the API key from ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 and
prints the latest builds with their processingState (PROCESSING / VALID /
INVALID / FAILED) so we can confirm a freshly uploaded build lands in TestFlight.
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import jwt

KEY_ID = "5J8MLZ4426"
ISSUER_ID = "40dabd9c-8645-44e4-9754-c6eefe759320"
KEY_PATH = Path.home() / ".appstoreconnect" / "private_keys" / f"AuthKey_{KEY_ID}.p8"
BUNDLE_ID = os.environ.get("BUNDLE_ID", "kr.lh.rebar-ar")

target = sys.argv[1] if len(sys.argv) > 1 else None


def make_token() -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": ISSUER_ID, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
        KEY_PATH.read_text(),
        algorithm="ES256",
        headers={"kid": KEY_ID, "typ": "JWT"},
    )


def api(path: str, token: str):
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path)
    req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    token = make_token()
    apps = api(f"/v1/apps?filter[bundleId]={BUNDLE_ID}", token)
    # ASC's bundleId filter is a prefix/loose match, so it can return sibling
    # apps (e.g. kr.lh.rebarcapture). Pick the exact match.
    matches = [a for a in apps.get("data", []) if a["attributes"].get("bundleId") == BUNDLE_ID]
    if not matches:
        print(f"No app found for bundleId {BUNDLE_ID}")
        return 1
    app = matches[0]
    app_id = app["id"]
    print(f"App: {app['attributes']['name']} ({app_id})")

    builds = api(
        f"/v1/builds?filter[app]={app_id}&limit=8&sort=-uploadedDate",
        token,
    )
    found = False
    for b in builds.get("data", []):
        a = b["attributes"]
        version = a.get("version")
        state = a.get("processingState")
        expired = a.get("expired")
        uploaded = a.get("uploadedDate")
        mark = "  <-- target" if target and version == target else ""
        if target and version == target:
            found = True
        print(f"  build {version}: {state}  expired={expired}  {uploaded}{mark}")
    if target and not found:
        print(f"  (build {target} not listed yet — ASC may still be registering it)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode(errors='replace')[:500]}")
        sys.exit(1)
