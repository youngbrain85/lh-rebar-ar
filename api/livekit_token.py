#!/usr/bin/env python3
"""Generate a LiveKit access token (JWT).

Reads credentials from ../secrets/livekit.env (gitignored). For production this
same signing logic lives in the token server endpoint — never ship the secret
in the app.

Usage:
  .venv/bin/python api/livekit_token.py [room] [identity] [name] [canPublish] [ttlSeconds]
"""
import sys
import time
from pathlib import Path

import jwt

ENV = Path(__file__).resolve().parent.parent / "secrets" / "livekit.env"
creds = {}
for line in ENV.read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        creds[k.strip()] = v.strip()

KEY = creds["LIVEKIT_API_KEY"]
SECRET = creds["LIVEKIT_API_SECRET"]

room = sys.argv[1] if len(sys.argv) > 1 else "ar-demo"
identity = sys.argv[2] if len(sys.argv) > 2 else "field"
name = sys.argv[3] if len(sys.argv) > 3 else identity
can_publish = (sys.argv[4].lower() != "false") if len(sys.argv) > 4 else True
ttl = int(sys.argv[5]) if len(sys.argv) > 5 else 7 * 24 * 3600

now = int(time.time())
token = jwt.encode(
    {
        "iss": KEY,
        "sub": identity,
        "name": name,
        "nbf": now,
        "iat": now,
        "exp": now + ttl,
        "video": {
            "room": room,
            "roomJoin": True,
            "canPublish": can_publish,
            "canSubscribe": True,
            "canPublishData": True,
        },
    },
    SECRET,
    algorithm="HS256",
)
print(token)
