# BriconLab 요청: as-built 스캔 저장/조회 API

현재 대시보드는 as-built 스캔(철근 중심선 JSON + 선택적 메시)을 Vercel Blob에
자체 저장하고 있습니다. 아래 3개 엔드포인트가 제공되면 BriconLab DB로 이관합니다.
필드명·경로는 협의 가능하며, 의미가 유지되면 됩니다.

## 1. POST /analysis/scan-upload  (multipart)
| field | type | 설명 |
|---|---|---|
| site_id | text | 기존 site-list의 site_id |
| captured_at | text | ISO8601 촬영 시각 |
| label | text(선택) | 사람이 읽을 이름 (예: "B동 지하1층 옹벽 東면"). **UTF-8로 보낼 것** — 목록 응답의 `name`이 "이름 · YYYY-MM-DD HH:mm" 형태로 만들어져 내려온다 |
| rebars | file | rebars.json (아래 스키마) |
| mesh | file(선택) | mesh.glb 시각화용 |

응답: `{ "status":"success", "scan_id":"<id>" }`

rebars.json:
{ "version":1, "unit":"m",
  "rebars":[ { "id":"r0", "centerline":[[x,y,z],...], "radius":0.008 } ] }
- centerline은 2점 이상, 좌표계는 스캔 앱 임의(정합은 대시보드 수행), 단위 m

## 2. GET /analysis/scan-list?site_id=5
응답: `{ "status":"success", "scan_list":[ { "scan_id", "site_id",
  "captured_at", "upload_at", "rebar_count", "has_mesh" } ] }` (upload_at 내림차순)

## 3. GET /analysis/scan-file?scan_id=<id>&file=rebars|mesh
해당 파일 스트림 응답 (rebars → application/json, mesh → model/gltf-binary)

## 4. (선택) 분석결과 저장
PUT/GET /analysis/scan-analysis?scan_id=<id> — JSON 본문 그대로 저장/반환.
미제공 시 분석결과는 계속 자체 스토리지에 보관합니다.
