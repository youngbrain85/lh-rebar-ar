#!/usr/bin/env python3
"""BriconLab MariaDB 조회 헬퍼.

자격증명은 `secrets/briconlab-db.env`(gitignore 대상)에서 읽는다. 코드에 하드코딩하지
않는다 — 이건 **상대사 운영 DB**다.

기본은 **읽기 전용**이다. 쓰기 문(INSERT/UPDATE/DELETE/DDL)은 `--write` 를 명시해야
실행된다. 실수로 상대 데이터를 건드리는 일을 한 겹 막기 위한 것이다.

사용법:
    python scripts/db.py databases
    python scripts/db.py tables <db>
    python scripts/db.py schema <db> <table>
    python scripts/db.py sql "SELECT ..."            # SELECT/SHOW/DESCRIBE 만
    python scripts/db.py sql "UPDATE ..." --write    # 쓰기는 명시적으로
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "secrets" / "briconlab-db.env"

READ_ONLY_RE = re.compile(r"^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH)\b", re.I)


def load_env() -> dict[str, str]:
    if not ENV_PATH.is_file():
        sys.exit(f"자격증명 파일이 없습니다: {ENV_PATH}")
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def connect(db: str | None = None):
    e = load_env()
    return pymysql.connect(
        host=e["DB_HOST"], port=int(e["DB_PORT"]),
        user=e["DB_USER"], password=e["DB_PASSWORD"],
        database=db, charset="utf8mb4",
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=20, read_timeout=60,
    )


def run(sql: str, db: str | None = None, allow_write: bool = False):
    if not allow_write and not READ_ONLY_RE.match(sql):
        sys.exit(
            "읽기 전용 모드입니다. 이 문장은 SELECT/SHOW/DESCRIBE/EXPLAIN 이 아닙니다.\n"
            "정말 쓰려면 --write 를 붙이세요 (상대사 운영 DB임을 유의)."
        )
    with connect(db) as conn, conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description] if cur.description else []
        if allow_write:
            conn.commit()
        return cols, rows


def show(cols, rows, limit: int = 200) -> None:
    if not cols:
        print(f"(rows affected: {len(rows)})")
        return
    widths = [len(c) for c in cols]
    body = [[("" if v is None else str(v)) for v in r] for r in rows[:limit]]
    for r in body:
        for i, v in enumerate(r):
            widths[i] = max(widths[i], min(len(v), 60))
    line = "  ".join(c.ljust(widths[i])[:60] for i, c in enumerate(cols))
    print(line)
    print("-" * min(len(line), 200))
    for r in body:
        print("  ".join(v.ljust(widths[i])[:60] for i, v in enumerate(r)))
    if len(rows) > limit:
        print(f"... ({len(rows)} rows, {limit} shown)")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["databases", "tables", "schema", "sql", "ping"])
    p.add_argument("args", nargs="*")
    p.add_argument("--db", default=None)
    p.add_argument("--write", action="store_true", help="쓰기 문 허용 (기본 금지)")
    p.add_argument("--limit", type=int, default=200)
    a = p.parse_args()

    if a.command == "ping":
        cols, rows = run("SELECT VERSION() AS version, CURRENT_USER() AS whoami, NOW() AS now")
        show(cols, rows)
    elif a.command == "databases":
        show(*run("SHOW DATABASES"), limit=a.limit)
    elif a.command == "tables":
        db = a.args[0] if a.args else a.db
        if not db:
            sys.exit("데이터베이스 이름을 주세요: python scripts/db.py tables <db>")
        show(*run("SHOW TABLE STATUS", db=db), limit=a.limit)
    elif a.command == "schema":
        if len(a.args) < 2:
            sys.exit("사용법: python scripts/db.py schema <db> <table>")
        db, table = a.args[0], a.args[1]
        show(*run(f"SHOW FULL COLUMNS FROM `{table}`", db=db), limit=a.limit)
    else:
        if not a.args:
            sys.exit("SQL 문을 주세요.")
        show(*run(a.args[0], db=a.db, allow_write=a.write), limit=a.limit)


if __name__ == "__main__":
    main()
