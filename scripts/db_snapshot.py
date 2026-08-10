#!/usr/bin/env python3
"""BriconLab DB 스냅샷 · 복원 — 쓰기 작업의 롤백 장치.

**이건 상대사(BriconLab) 운영 DB다.** 우리가 무언가 쓰기 전에 반드시 스냅샷을
먼저 뜬다. 스키마 전체가 7테이블 200여 행이라 통째로 뜨는 비용이 거의 없다.

    # 쓰기 전 — 항상 이것부터
    python scripts/db_snapshot.py dump

    # 무엇이 달라졌는지 (쓰기 후 확인 / 사고 감지)
    python scripts/db_snapshot.py diff backups/LH-20260811-0203.json

    # 되돌리기 — 표를 통째로 스냅샷 시점으로 되돌린다
    python scripts/db_snapshot.py restore backups/LH-20260811-0203.json --tables ar_result --confirm

설계 노트:
- 스냅샷은 **JSON**이다. SQL 덤프보다 검증하기 쉽고(다시 읽어 SELECT 결과와
  바로 비교할 수 있다) mysqldump 바이너리에 의존하지 않는다 — Windows에서도 된다.
- `restore` 는 대상 테이블을 **트랜잭션 안에서 DELETE 후 재삽입**한다. 부분 복원
  중간에 실패하면 통째로 롤백된다. 스키마(DDL)는 건드리지 않는다.
- `--confirm` 없이는 아무것도 쓰지 않는다. 되돌릴 테이블도 `--tables` 로 명시해야
  한다 — "전부 되돌리기"를 기본값으로 두지 않는다.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db import connect  # noqa: E402  (같은 자격증명·연결 규칙을 공유한다)

ROOT = Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT / "backups"
SCHEMA = "LH"


def fetch_all(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT TABLE_NAME FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA=%s ORDER BY TABLE_NAME", (SCHEMA,),
        )
        tables = [r[0] for r in cur.fetchall()]

        out: dict = {
            "schema": SCHEMA,
            "taken_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "tables": {},
        }
        for t in tables:
            cur.execute(f"SHOW FULL COLUMNS FROM `{t}`")
            cols = [r[0] for r in cur.fetchall()]
            cur.execute(f"SELECT * FROM `{t}`")
            rows = [
                # JSON에 담기 위해 date/decimal 등은 문자열로. 복원 시 MariaDB가
                # 다시 해석하므로 왕복에 손실이 없다.
                [None if v is None else (v if isinstance(v, (int, float, str)) else str(v))
                 for v in r]
                for r in cur.fetchall()
            ]
            out["tables"][t] = {"columns": cols, "rows": rows}
    return out


def cmd_dump(path: Path | None) -> None:
    with connect(SCHEMA) as conn:
        snap = fetch_all(conn)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if path is None:
        stamp = snap["taken_at"].replace(":", "").replace("-", "").replace("+0000", "Z")
        path = BACKUP_DIR / f"{SCHEMA}-{stamp}.json"
    path.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(t["rows"]) for t in snap["tables"].values())
    print(f"스냅샷 저장: {path}")
    for name, t in snap["tables"].items():
        print(f"  {name:<20} {len(t['rows']):>5} 행")
    print(f"  합계 {total} 행 / {len(snap['tables'])} 테이블")


def load(path: Path) -> dict:
    if not path.is_file():
        sys.exit(f"스냅샷 파일이 없습니다: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def cmd_diff(path: Path) -> None:
    """스냅샷 시점과 지금의 차이. 쓰기 후 확인 + 남이 바꾼 것 감지."""
    old = load(path)
    with connect(SCHEMA) as conn:
        new = fetch_all(conn)

    changed = False
    names = sorted(set(old["tables"]) | set(new["tables"]))
    for t in names:
        o = old["tables"].get(t)
        n = new["tables"].get(t)
        if o is None:
            print(f"[신규 테이블] {t} ({len(n['rows'])} 행)"); changed = True; continue
        if n is None:
            print(f"[삭제된 테이블] {t}"); changed = True; continue
        if o["columns"] != n["columns"]:
            print(f"[컬럼 변경] {t}\n    이전: {o['columns']}\n    현재: {n['columns']}")
            changed = True
        os_, ns_ = {json.dumps(r, ensure_ascii=False) for r in o["rows"]}, \
                   {json.dumps(r, ensure_ascii=False) for r in n["rows"]}
        added, removed = ns_ - os_, os_ - ns_
        if added or removed:
            changed = True
            print(f"[행 변경] {t}  +{len(added)} / -{len(removed)}")
            for r in list(removed)[:5]:
                print(f"    - {r[:160]}")
            for r in list(added)[:5]:
                print(f"    + {r[:160]}")
    if not changed:
        print(f"차이 없음 — 스냅샷({old['taken_at']}) 이후 변경되지 않았습니다.")


def cmd_restore(path: Path, tables: list[str], confirm: bool) -> None:
    snap = load(path)
    unknown = [t for t in tables if t not in snap["tables"]]
    if unknown:
        sys.exit(f"스냅샷에 없는 테이블: {unknown}")

    print(f"복원 대상 (스냅샷 {snap['taken_at']}):")
    for t in tables:
        print(f"  {t}: 현재 내용을 지우고 {len(snap['tables'][t]['rows'])} 행으로 되돌립니다")
    if not confirm:
        sys.exit("\n--confirm 을 붙여야 실제로 실행됩니다. (상대사 운영 DB입니다)")

    with connect(SCHEMA) as conn:
        try:
            with conn.cursor() as cur:
                for t in tables:
                    data = snap["tables"][t]
                    cols = ", ".join(f"`{c}`" for c in data["columns"])
                    ph = ", ".join(["%s"] * len(data["columns"]))
                    cur.execute(f"DELETE FROM `{t}`")
                    if data["rows"]:
                        cur.executemany(
                            f"INSERT INTO `{t}` ({cols}) VALUES ({ph})",
                            [tuple(r) for r in data["rows"]],
                        )
                    print(f"  {t}: {len(data['rows'])} 행 복원")
            conn.commit()
            print("복원 완료 (커밋).")
        except Exception as e:
            conn.rollback()
            sys.exit(f"복원 실패 — 전부 롤백했습니다: {e}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["dump", "diff", "restore"])
    p.add_argument("path", nargs="?", type=Path)
    p.add_argument("--tables", nargs="+", default=[], help="restore 대상 테이블 (명시 필수)")
    p.add_argument("--confirm", action="store_true", help="restore 를 실제로 실행")
    a = p.parse_args()

    if a.command == "dump":
        cmd_dump(a.path)
    elif a.command == "diff":
        if not a.path:
            sys.exit("비교할 스냅샷 파일을 주세요.")
        cmd_diff(a.path)
    else:
        if not a.path:
            sys.exit("복원할 스냅샷 파일을 주세요.")
        if not a.tables:
            sys.exit("--tables 로 되돌릴 테이블을 명시하세요 (전체 복원을 기본값으로 두지 않습니다).")
        cmd_restore(a.path, a.tables, a.confirm)


if __name__ == "__main__":
    main()
