#!/usr/bin/env python3
"""Print the next TestFlight build number (max existing + 1) for the app.

Used by CI to auto-increment without committing project.yml back. Reads the
App Store Connect API key from env + ~/.appstoreconnect/private_keys/.

Env: ASC_KEY_ID, ASC_ISSUER_ID, optional BUNDLE_ID (default kr.lh.rebar-ar).
"""
import json
import os
import time
import urllib.request
from pathlib import Path

import jwt

KEY = os.environ["ASC_KEY_ID"]
ISS = os.environ["ASC_ISSUER_ID"]
BUNDLE = os.environ.get("BUNDLE_ID", "kr.lh.rebar-ar")
p8 = Path.home() / ".appstoreconnect" / "private_keys" / f"AuthKey_{KEY}.p8"

now = int(time.time())
token = jwt.encode(
    {"iss": ISS, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
    p8.read_text(),
    algorithm="ES256",
    headers={"kid": KEY, "typ": "JWT"},
)


def api(path):
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path)
    req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req, timeout=30))


apps = api(f"/v1/apps?filter[bundleId]={BUNDLE}")
matches = [a for a in apps.get("data", []) if a["attributes"].get("bundleId") == BUNDLE]
if not matches:
    print(1)
    raise SystemExit

app_id = matches[0]["id"]
builds = api(f"/v1/builds?filter[app]={app_id}&limit=200")
nums = [
    int(b["attributes"]["version"])
    for b in builds.get("data", [])
    if str(b["attributes"].get("version", "")).isdigit()
]
print(max(nums) + 1 if nums else 1)
