# 시공 분석 대시보드 (Rebar As-Built Analysis) — 설계 문서

**날짜**: 2026-07-27
**상태**: 승인됨 (사용자 검토 완료)
**대상**: office-dashboard (Next.js) — 새 "시공 분석" 탭

## 1. 목적과 배경

다른 저장소에서 개발 중인 라이다 스캔 앱이 현장 구조물을 스캔해 **as-built 3D 모델**을
생성한다. 이 모델을 업로드받아, 기존에 저장된 **설계모델**(BriconLab USDZ)과
정합(registration)한 뒤 철근별로 비교 분석하여 다음을 시각화한다:

- 총 철근 개수 (설계 vs 시공)
- 철근 분류 (방향: 수평/수직, 레이어: 외측/내측)
- 시공오차 (철근별 편차 mm, 평균/최대)
- 미시공 철근 (설계에 있으나 시공에서 미발견)
- 허용오차 초과 철근 수 (기준 조정 가능, 기본 ±10mm)
- 도면 외 철근 (시공에 있으나 설계에 없음)

이 기능은 라이브 협업과 **독립적인** 별도 탭이다.

## 2. 확정된 결정사항

| 결정 | 내용 | 근거 |
|---|---|---|
| 분석 위치 | **브라우저 내** (Web Worker, 순수 TS) | 서버 추가 없이 Vercel 그대로 배포. 중심선 데이터는 작아서 클라이언트 연산으로 충분 |
| 저장소 | **하이브리드**: 지금은 자체 스토리지(Vercel Blob), BriconLab 이관 스펙 병행 작성 | BriconLab은 현재 스캔 조회 엔드포인트가 없고(`scan-list` 404), 구현 대기 이력이 김 |
| 입력 계약 | **세그멘테이션된 입력 전제**: 라이다 앱이 철근별 중심선+반경 JSON 제공 | 포인트클라우드 세그멘테이션을 브라우저에서 하는 것은 v1 범위 초과. 라이다 앱도 자체 개발 중이라 계약 정의 가능 |
| 허용오차 | **UI에서 조정 가능, 기본 ±10mm** | 현장별 시방 차이 대응 |
| 알고리즘 | **중심선 기반** (A안): PCA 코스 정합 + point-to-line ICP + 분류별 1:1 매칭 | 메시 기반 ICP는 무겁고 계약상 중심선을 이미 받으므로 이점 없음. 수동 정합은 폴백으로만 |

## 3. 아키텍처

```
라이다 앱 (별도 저장소, Python)
   │  POST /api/scan-upload  (Bearer 토큰)
   ▼
office-dashboard API 라우트 ──── Vercel Blob
   │   /api/scans, /api/scan,        (rebars.json, mesh.glb,
   │   /api/analysis-result           analysis-result.json)
   ▼
시공 분석 탭 (클라이언트)
   ├─ 설계모델: 기존 /api/model?ar_id= (BriconLab USDZ 프록시) 재사용
   ├─ 분석 엔진: src/lib/analysis/* 순수 TS → 메인스레드 실행 (실측 <100ms; Turbopack 워커 번들 미지원 확인)
   └─ 뷰어: three.js (기존 ModelViewer 패턴 재사용) + Mantine UI
```

### 신규 파일 배치 (office-dashboard/src/)

```
app/api/scan-upload/route.ts      # POST 업로드 (Bearer 검증, zod 스키마 검증)
app/api/scans/route.ts            # GET ?site_id= → 스캔 목록
app/api/scan/route.ts             # GET ?scan_id=&file= → rebars.json | mesh.glb
app/api/analysis-result/route.ts  # PUT/GET 분석결과 JSON
lib/analysis/types.ts             # Rebar, Centerline, AnalysisResult 등 공용 타입
lib/analysis/designExtract.ts     # USDZ 씬 → 철근별 중심선 추출 (PCA)
lib/analysis/registration.ts      # 코스(PCA+플립 채점) + 파인(point-to-line ICP)
lib/analysis/classify.ts          # 방향/레이어 분류
lib/analysis/match.ts             # 분류 그룹 내 1:1 매칭, 미시공/도면외 판별
lib/analysis/judge.ts             # 허용오차 판정 + 요약통계 (재판정 전용, 빠름)
components/analysis/AnalysisView.tsx    # 분석 화면 (3D + 카드 + 테이블 + 슬라이더)
components/analysis/AnalysisViewer.tsx  # three.js 오버레이 뷰어
components/analysis/ScanList.tsx        # 사이트별 스캔 목록
```

신규 의존성: `@vercel/blob`, `zod`, `vitest`(dev). 그 외 추가 금지.

## 4. 업로드 계약 (라이다 앱 → 대시보드)

```
POST /api/scan-upload
Authorization: Bearer <SCAN_UPLOAD_TOKEN>     # 환경변수, 라이다 앱과 공유
Content-Type: multipart/form-data

fields:
  site_id       (text, 필수)   BriconLab site_id와 동일 체계
  captured_at   (text, 필수)   ISO8601
  rebars        (file, 필수)   rebars.json (아래 스키마)
  mesh          (file, 선택)   mesh.glb — 시각화용, 분석에는 불사용

응답: { "scan_id": "<uuid>", "rebar_count": N }
```

```jsonc
// rebars.json 스키마 (zod로 검증)
{
  "version": 1,
  "unit": "m",                       // "m"만 허용 (v1)
  "rebars": [
    {
      "id": "r0",                    // 스캔 내 고유
      "centerline": [[x,y,z], ...],  // 2점 이상, 임의 좌표계
      "radius": 0.008                // meters
    }
  ]
}
```

- 좌표계: 라이다 앱 임의 좌표 그대로. 정합은 대시보드가 수행.
- 검증 실패 시 400 + 필드별 오류 메시지. NaN/Inf, 빈 배열, 단위 불일치 거부.
- Blob 키 구조: `scans/<site_id>/<scan_id>/rebars.json`, `.../mesh.glb`,
  `.../analysis-result.json`. 목록은 Blob prefix 조회로 구성 (별도 DB 없음, v1).
- **BriconLab 이관**: 동일 의미의 엔드포인트 스펙을 `api/SCAN_STORAGE_REQUEST.md`로
  작성해 벤더에 전달. 구현되면 API 라우트 내부만 프록시로 교체 (클라이언트 무변경).

## 5. 분석 파이프라인

모두 `lib/analysis/`의 순수 함수. Worker에서 실행하고 진행 단계를 postMessage로 보고.

### 5.1 설계 중심선 추출 (designExtract)

- 기존 `/api/model?ar_id=`로 USDZ 로드 (three.js USDLoader — ModelViewer와 동일 경로).
- 씬의 이름 있는 서브오브젝트(`rebar_N*`)별로: 정점에 PCA → 주축 투영 →
  중심선 선분(양 끝점), 반경 = 주축 직교 방향 정점 거리의 중앙값.
- 서브오브젝트 이름이 없거나 1개뿐인 모델: 연결요소(connected components) 분리 폴백.
- 산출: 설계 철근 배열 (as-built와 동일한 `Rebar` 타입).

### 5.2 정합 (registration) — as-built 좌표를 설계 좌표로

- **코스**: 양쪽 철근군 중심선 샘플점의 PCA 주축 3개를 정렬. 주축 부호 모호성으로
  생기는 4가지 유효 회전 후보(det=+1) 각각에 대해 최근접 중심선 비용을 계산,
  최소 비용 후보 채택.
- **파인**: as-built 중심선을 따라 샘플링한 점들 → 설계 중심선 **선분**까지의
  point-to-line ICP (강체 변환만, 스케일 고정 1:1). 반복 상한 20회,
  수렴 기준 ΔRMS < 0.1mm.
- 산출: 4×4 강체 변환행렬 + 최종 RMS 잔차.
- **실패 판정**: RMS > 30mm 또는 PCA 퇴화(고유값 비율 임계) → UI에 경고 배너 +
  수동 폴백(§7).

### 5.3 분류 (classify)

- 방향: 중심선 지배축이 수평면에 가까우면 **수평**, 아니면 **수직** (설계 좌표 기준).
- 레이어: 벽면 법선 방향(철근군 분포가 가장 얇은 PCA 축) 좌표를 1D 클러스터링
  (k=2 시도, 분리도 낮으면 단일 레이어) → **외측/내측**.
- 설계·as-built 양쪽에 동일 로직 적용.

### 5.4 매칭 (match)

- 같은 (방향, 레이어) 그룹 내에서만 매칭.
- 비용 = 두 중심선 간 평균 수직거리. 그룹 내 그리디 최소비용 1:1 매칭
  (비용 오름차순으로 짝 확정).
- 컷오프 = 해당 그룹 설계 배근간격 중앙값의 ½ (자동 산출). 컷오프 초과는 미매칭.
- 미매칭 설계철근 → **미시공(missing)**. 미매칭 as-built → **도면 외(extra)**.

### 5.5 판정 (judge)

- 매칭 쌍: 편차 = 중심선 간 수직거리의 평균(대표값)과 최대. `평균 > 허용오차` →
  **허용초과(out-of-tolerance)**, 이하 → **정상(pass)**.
- 요약: 설계/시공 철근 수, 분류별 집계, 편차 평균·최대, 미시공/허용초과/도면외 수.
- **허용오차 변경 시 judge만 재실행** (정합·매칭 결과 재사용, <1ms).

### 5.6 결과 스키마 (AnalysisResult)

```jsonc
{
  "version": 1,
  "scanId": "...", "arId": "...",
  "registration": { "matrix": [16], "rmsMm": 4.2, "method": "auto" | "manual" },
  "toleranceMm": 10,
  "rebars": [{
    "designId": "rebar_3" | null,      // null = 도면 외
    "scanId": "r7" | null,             // null = 미시공
    "direction": "horizontal" | "vertical",
    "layer": "outer" | "inner",
    "deviationMm": { "mean": 6.1, "max": 9.8 } | null,
    "verdict": "pass" | "out_of_tolerance" | "missing" | "extra"
  }],
  "summary": {
    "designCount": 27, "scanCount": 26,
    "matched": 25, "missing": 1, "extra": 1, "outOfTolerance": 3,
    "deviationMm": { "mean": 5.2, "max": 14.1 },
    "byGroup": [{ "direction": "horizontal", "layer": "outer",
                  "designCount": 7, "scanCount": 7, "missing": 0,
                  "outOfTolerance": 1, "meanDeviationMm": 4.8 }]
  }
}
```

Blob에 저장 (`PUT /api/analysis-result`). 재방문 시 로드해 재계산 생략,
허용오차 슬라이더만 클라이언트 재판정.

## 6. UI / 시각화

내비게이션: 현장 관리 / 라이브 협업 / **시공 분석**.

흐름: 현장 선택 → 스캔 목록(업로드 일시, 철근 수, 분석 여부 배지) → 분석 화면.

분석 화면 (데스크톱 우선, Mantine + 기존 네이비 `#002961` 테마):

- **3D 오버레이 뷰어** (좌측 대부분):
  - 설계모델 USDZ: 반투명 회색 고스트
  - as-built 철근: **중심선 기반 원통 렌더**(철근별 판정 색 적용의 유일한 경로) —
    정상 **초록**, 허용초과 **주황**, 도면 외 **파랑**. mesh.glb는 별도
    "스캔 메시" 토글로 켜는 참조 레이어(단색 반투명, 기본 꺼짐)
  - 미시공: 설계 위치에 **빨간** 고스트 원통
  - 방향/레이어/판정별 표시 토글, OrbitControls (ModelViewer 패턴)
- **우측 패널**:
  - 요약 카드: 설계/시공 수, 미시공 n, 허용초과 n, 평균·최대 오차
  - 분류별 집계 표 (방향 × 레이어)
  - 허용오차 슬라이더 (1–50mm, 기본 10) — 즉시 재판정
  - 철근별 테이블: id, 분류, 편차, 판정. 행 클릭 → 카메라 포커스 + 하이라이트
- 분석 실행 버튼 + 단계별 진행 표시 (추출→정합→매칭→판정). 완료 시 결과 자동 저장.

## 7. 오류 처리

| 상황 | 처리 |
|---|---|
| 정합 실패 (RMS>30mm, PCA 퇴화) | 경고 배너 + 수동 폴백: 이동 XYZ / 요 회전 넛지 UI로 초기정합 잡고 파인 ICP 재실행. 결과에 `method:"manual"` 기록 |
| rebars.json 스키마 위반 | 업로드 400 + 필드별 메시지 (라이다 앱 디버깅용) |
| USDZ 서브오브젝트 이름 없음 | 연결요소 분리 폴백, 그래도 1개면 분석 불가 안내 |
| `BLOB_READ_WRITE_TOKEN`/`SCAN_UPLOAD_TOKEN` 미설정 | API 500 대신 명시적 배너 (조용히 삼키지 않음 — `/api/live`의 침묵 실패 전철 금지) |
| 대형 mesh.glb | 뷰어 로드만 지연 로딩, 분석은 JSON만 사용하므로 무관 |
| 결과 스키마 버전 불일치 | 재분석 유도 (마이그레이션 없음, v1) |

## 8. 테스트

대시보드 최초의 테스트 인프라: **vitest** (`npm test`). `lib/analysis/`가 순수 TS라
DOM/three.js 없이 테스트 가능 (designExtract만 three 의존 — 정점 배열 입력으로 분리).

- **합성 픽스처 생성기**: 격자 철근망 생성 → 기지의 강체변환 + 가우시안 노이즈 +
  철근 제거/추가/오프셋 주입.
- 정합: 4가지 플립 케이스 전수 — 복원 변환 오차 < 1mm/0.1°.
- 매칭: 제거한 철근이 정확히 missing으로, 추가분이 extra로 나오는지.
- 판정: 주입 오프셋 ±ε = 산출 편차; 허용오차 경계값 테스트.
- 설계 추출: 번들 샘플 OBJ(철근 27개, `rebar_N_PASS/MISSING` 명명)를 정점 배열
  픽스처로 변환해 27개 중심선 추출 검증.
- API 라우트: 업로드 검증(400 케이스) 단위 테스트. E2E는 브라우저 프리뷰로 수동.

## 9. 범위 제외 (v1)

- 포인트클라우드/통짜 메시 세그멘테이션 (라이다 앱 책임으로 계약)
- 곡선 철근 (중심선 polyline은 받지만 분류·매칭은 직선 지배축 가정)
- 배근 간격(spacing) 검사, 피복두께 검사 — 후속 확장
- 보고서 PDF 내보내기
- 분석결과의 BriconLab 저장 (스펙 문서만 전달)
- 모바일 레이아웃 최적화
