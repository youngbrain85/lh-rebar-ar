# BriconLab API — 측정 캡처 업로드 요청

## 배경
iOS 앱에서 검측자가 AR로 측정한 결과를 **화면 캡처 이미지 + 측정 데이터**로 서버 DB에
저장하려 합니다. 기존 `POST /analysis/upload`(PLY 업로드, multipart,
`site_id`/`inspector`/`remark`)와 **동일한 패턴**이라 그대로 본뜨면 됩니다.

## 흐름 (수동 캡처)
검측자가 측정을 여러 개 찍은 뒤 **카메라 버튼**을 누르면 → 그 화면 이미지 1장 +
**그 캡처에 포함된 모든 측정**을 한 번에 업로드합니다.
→ **1 캡처 = 이미지 1장 + 측정 N개.**

## 요청: 측정 캡처 업로드 엔드포인트
```
POST /analysis/measurement-upload      (multipart/form-data)
  file         : 캡처 이미지 (image/jpeg)
  site_id      : 현장 id (int)
  ar_id        : 기준 모델 id (string, optional — 모델 없이 측정 시 빈 값)
  inspector    : 검측자 (string)
  remark       : 비고 (string, optional)
  captured_at  : ISO8601 시각
  measurements : JSON 문자열(배열) — 이 캡처의 모든 측정
     [
       { "idx": 1, "id": "<uuid>",
         "point_a": [x, y, z], "point_b": [x, y, z],
         "distance_m": 0.284, "horizontal_m": 0.271, "vertical_m": 0.083,
         "source_a": "model|real", "source_b": "model|real" },
       { "idx": 2, ... }
     ]
```
응답(예): `{ "status": "success", "capture_id": "...", "message": "..." }`
— `capture_id`로 이후 조회/연계.

## DB 모델 (권장: 1:N)
- **capture**: `id, site_id, ar_id, inspector, remark, captured_at, image_path`
- **measurement**: `capture_id(FK), idx, point_a, point_b, distance_m, horizontal_m,
  vertical_m, source_a, source_b, uuid`
- (또는 measurements를 capture 레코드의 **JSON 컬럼**으로 통째 저장 — 단순하지만,
  "수직편차 N mm 이상 측정 검색" 같은 쿼리는 1:N 테이블이 유리)

## 참고
- 좌표계: AR 월드(미터, Y-up 중력 기준). `distance/horizontal/vertical` 모두 **미터**.
  - `horizontal = √(Δx²+Δz²)`, `vertical = |Δy|`
- 이미지엔 각 측정 선에 **번호(#1, #2…)**가 그려져 있어 `measurements`의 `idx`와 매칭됩니다.
- **인증**: 현재 없음(기존 upload와 동일). 추후 추가되면 헤더만 맞추면 됩니다.
- 베이스 URL: `http://api.briconlab.com:50001`

## 검증
- 엔드포인트 경로/필드명이 위와 달라도 됩니다 — **확정 스펙만 알려주시면** 앱에서 맞춰
  연결하겠습니다. 샘플 1건 업로드해 응답 형식만 확인되면 바로 붙입니다.
