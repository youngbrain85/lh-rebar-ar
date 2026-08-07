#!/usr/bin/env python3
"""App Store Connect 인증서 관리 — 목록 / 발급 / 폐기.

**왜 필요한가**: CI가 `xcodebuild -allowProvisioningUpdates`로 클라우드 서명을 하면
실행마다 **새 배포 인증서를 만든다**. 러너는 매번 깨끗한 macOS라 키체인이 비어 있고,
Xcode는 쓸 인증서가 없으니 Apple에 새로 요청한다. Apple의 배포 인증서 한도는 2~3개라
한두 번 빌드하면 꽉 차고, 그때부터 아카이브가 이 오류로 죽는다:

    error: Choose a certificate to revoke. Your account has reached the
           maximum number of certificates.

해결은 **고정 인증서 하나를 만들어 CI 시크릿에 넣고 키체인에 임포트**하는 것이다.
그러면 Xcode가 새로 만들 이유가 없어져 한도에 다시 걸리지 않는다.
이 스크립트가 그 인증서를 Mac 없이(Windows에서) 만든다.

사용법:
    python scripts/asc_cert.py list
    python scripts/asc_cert.py create --out build/dist-cert
    python scripts/asc_cert.py revoke <certificate-id>

환경변수(또는 인자):
    ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH(.p8 경로)
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import jwt  # pyjwt

BASE = "https://api.appstoreconnect.apple.com/v1"


def make_token(key_id: str, issuer_id: str, key_path: Path) -> str:
    private_key = key_path.read_text()
    now = int(time.time())
    return jwt.encode(
        {"iss": issuer_id, "iat": now, "exp": now + 19 * 60, "aud": "appstoreconnect-v1"},
        private_key,
        algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )


def call(token: str, method: str, path: str, body: dict | None = None) -> dict:
    url = path if path.startswith("http") else f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise SystemExit(f"ASC API {method} {path} → HTTP {e.code}\n{detail}")


def cmd_list(token: str) -> None:
    res = call(token, "GET", "/certificates?limit=200")
    rows = res.get("data", [])
    if not rows:
        print("인증서가 없습니다.")
        return
    print(f"{'ID':<12} {'TYPE':<24} {'만료':<22} 이름")
    for c in rows:
        a = c["attributes"]
        print(
            f"{c['id']:<12} {a.get('certificateType',''):<24} "
            f"{str(a.get('expirationDate',''))[:19]:<22} {a.get('displayName','')}"
        )
    dist = [c for c in rows if c["attributes"].get("certificateType") == "DISTRIBUTION"]
    print(f"\n총 {len(rows)}개 · 그중 DISTRIBUTION {len(dist)}개")
    if len(dist) >= 2:
        print("⚠ 배포 인증서가 한도(보통 2개)에 도달했습니다 — 새로 만들려면 먼저 폐기해야 합니다.")


def cmd_create(token: str, out_stem: Path, p12_password: str) -> None:
    out_stem.parent.mkdir(parents=True, exist_ok=True)
    key_pem = out_stem.with_suffix(".key.pem")
    csr_pem = out_stem.with_suffix(".csr.pem")
    cer_der = out_stem.with_suffix(".cer")
    cer_pem = out_stem.with_suffix(".cer.pem")
    p12 = out_stem.with_suffix(".p12")

    # 1) 개인키 + CSR. 이 개인키가 인증서의 짝이며, **이것을 잃으면 인증서도 못 쓴다**.
    #    클라우드 서명이 만든 인증서들은 러너와 함께 개인키가 사라져 재사용이 불가능했다.
    print("1/4 개인키·CSR 생성 (openssl)")
    subprocess.run(
        ["openssl", "req", "-newkey", "rsa:2048", "-nodes",
         "-keyout", str(key_pem), "-out", str(csr_pem),
         "-subj", "/CN=LH Rebar AR CI/O=LH/C=KR"],
        check=True, capture_output=True,
    )

    csr_content = csr_pem.read_text()

    # 2) ASC에 CSR을 올려 배포 인증서를 발급받는다
    print("2/4 App Store Connect에 인증서 요청")
    res = call(token, "POST", "/certificates", {
        "data": {
            "type": "certificates",
            "attributes": {"csrContent": csr_content, "certificateType": "DISTRIBUTION"},
        }
    })
    attrs = res["data"]["attributes"]
    cert_id = res["data"]["id"]
    cer_der.write_bytes(base64.b64decode(attrs["certificateContent"]))
    print(f"    발급됨: id={cert_id} 만료={str(attrs.get('expirationDate',''))[:19]}")

    # 3) DER → PEM
    print("3/4 인증서 변환")
    subprocess.run(
        ["openssl", "x509", "-inform", "DER", "-in", str(cer_der), "-out", str(cer_pem)],
        check=True, capture_output=True,
    )

    # 4) 개인키 + 인증서를 .p12로 묶는다 — CI가 키체인에 임포트할 형식.
    #    macOS 키체인 호환을 위해 -legacy(RC2/3DES)를 쓴다. OpenSSL 3은 기본이
    #    AES-256인데 오래된 security(1) 임포터가 못 읽는 경우가 있다.
    print("4/4 .p12 패키징")
    subprocess.run(
        ["openssl", "pkcs12", "-export", "-legacy",
         "-inkey", str(key_pem), "-in", str(cer_pem),
         "-out", str(p12), "-name", "LH Rebar AR CI",
         "-passout", f"pass:{p12_password}"],
        check=True, capture_output=True,
    )

    b64 = base64.b64encode(p12.read_bytes()).decode()
    b64_path = out_stem.with_suffix(".p12.base64")
    b64_path.write_text(b64)

    print(f"\n완료. certificate id = {cert_id}")
    print(f"  .p12          {p12}")
    print(f"  base64        {b64_path}  ({len(b64)} chars)")
    print("\n다음 단계 — GitHub 시크릿 두 개를 설정하세요:")
    print(f"  gh secret set IOS_DIST_CERT_P12 < {b64_path}")
    print("  gh secret set IOS_DIST_CERT_PASSWORD    (값: 위에서 쓴 비밀번호)")
    print("\n★ .key.pem / .p12 / .base64 는 개인키를 담고 있습니다. 시크릿 설정 후 지우세요.")


def cmd_revoke(token: str, cert_id: str) -> None:
    call(token, "DELETE", f"/certificates/{cert_id}")
    print(f"폐기됨: {cert_id}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["list", "create", "revoke"])
    p.add_argument("target", nargs="?", help="revoke 할 certificate id")
    p.add_argument("--key-id", default=os.environ.get("ASC_KEY_ID"))
    p.add_argument("--issuer-id", default=os.environ.get("ASC_ISSUER_ID"))
    p.add_argument("--key-path", default=os.environ.get("ASC_KEY_PATH"))
    p.add_argument("--out", default="build/dist-cert", help="create 산출물 경로 접두")
    p.add_argument("--p12-password", default=os.environ.get("P12_PASSWORD", "lhrebar-ci"))
    args = p.parse_args()

    missing = [n for n, v in
               (("--key-id/ASC_KEY_ID", args.key_id),
                ("--issuer-id/ASC_ISSUER_ID", args.issuer_id),
                ("--key-path/ASC_KEY_PATH", args.key_path)) if not v]
    if missing:
        sys.exit("필요한 값이 없습니다: " + ", ".join(missing))

    key_path = Path(args.key_path)
    if not key_path.is_file() or key_path.stat().st_size == 0:
        sys.exit(f"ASC API 키 파일이 비어 있거나 없습니다: {key_path}")

    token = make_token(args.key_id, args.issuer_id, key_path)

    if args.command == "list":
        cmd_list(token)
    elif args.command == "create":
        cmd_create(token, Path(args.out), args.p12_password)
    else:
        if not args.target:
            sys.exit("revoke 하려면 certificate id를 주세요 (list로 확인)")
        cmd_revoke(token, args.target)


if __name__ == "__main__":
    main()
