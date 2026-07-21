# BriconLab API — USDZ 모델 제공 요청

## 배경
iOS AR 앱(RealityKit)은 **USDZ 포맷만** 3D 모델로 로드할 수 있습니다. 현재
`GET /analysis/fbx?ar_id=…` 가 주는 **FBX는 iOS에서 직접 렌더할 수 없습니다**
(Apple 네이티브 미지원, 온디바이스 변환 불가). 따라서 **서버에서 USDZ로 변환해
내려주는** 엔드포인트가 필요합니다.

## 요청: USDZ 다운로드 엔드포인트 추가
ar_id로 USDZ 파일을 받을 수 있게 해주세요. 둘 중 편한 방식:

- **(권장) 신규 엔드포인트**
  `GET /analysis/usdz?ar_id={ar_id}` → USDZ 바이너리 응답
  - `Content-Type: model/vnd.usdz+zip` (또는 `application/octet-stream`)
  - 기존 `fbx` 엔드포인트와 동일하게 **Range 요청 지원** 유지
- 또는 **기존 엔드포인트에 포맷 파라미터**
  `GET /analysis/fbx?ar_id={ar_id}&format=usdz`

## 변환 시 반드시 지켜야 할 것 (중요)
엔지니어링 검측 도구라 **방향·스케일이 정확**해야 합니다.

1. **업축(up-axis): Z-up → Y-up**
   FBX는 보통 Z-up(레빗/3ds Max), USD/RealityKit은 **Y-up**입니다. 변환 시
   up-axis를 Y-up으로 맞춰주세요. (안 맞으면 모델이 90° 누워서 뜹니다.)
2. **단위: cm → m (1:1 실척)**
   FBX가 cm면 USD의 `metersPerUnit = 1.0`(미터) 기준으로 실제 치수와 1:1이
   되도록 스케일 보정. (스케일이 틀리면 측정이 무의미해집니다.)
3. **원점**: 가능하면 모델 바닥이 원점 근처(접지)면 AR 배치가 깔끔합니다. (선택)
4. **재질/텍스처**는 USDZ 내부에 임베드(zip 패키징).
5. **캐싱**: 모델은 자주 안 바뀌므로 **최초 1회 변환 후 USDZ를 캐시**해서 재사용하면
   요청마다 변환 비용이 들지 않습니다.

## 서버측 변환 방법 제안 (FastAPI/Linux 환경 기준)
- **(권장) Blender 헤드리스** — 무료, 리눅스 동작, FBX import + USDZ export, 축/단위
  처리 양호. 대략:
  ```bash
  blender --background --python-expr \
  "import bpy; bpy.ops.wm.read_factory_settings(use_empty=True); \
   bpy.ops.import_scene.fbx(filepath='in.fbx'); \
   bpy.ops.wm.usd_export(filepath='out.usdz')"
  ```
  (샘플 1개로 방향 확인 후, 필요하면 import의 `axis_up`/`global_scale` 플래그 조정)
- 대안: **FBX2glTF**(FBX→glTF) → USD 변환, 또는 **Aspose.3D**(상용) 등.

## 검증
- **샘플 USDZ 1개**만 먼저 주시면, 우리가 앱에서 **방향·스케일이 맞는지 즉시 확인**하고
  피드백 드리겠습니다.
- 엔드포인트 경로/파라미터가 위 제안과 달라도 됩니다 — **확정된 경로만 알려주시면**
  앱에서 그에 맞춰 연결하겠습니다.

## 참고 (현재 확인된 사항)
- 베이스 URL: `http://api.briconlab.com:50001` (컬렉션의 `https://…:443`은 미연결)
- 인증 없음, FastAPI(uvicorn)
- `fbx` 응답 예시: Kaydara FBX v7700, 약 264KB, Range 지원
