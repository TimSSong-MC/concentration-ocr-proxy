# OCR 프록시 서버 (Google Cloud Run)

이 디렉토리는 Google Cloud Run에 배포되는 OCR 프록시 서버입니다.

## 구조

```
ocr-proxy/
├── Dockerfile          # Cloud Run 배포용
├── package.json        # Node.js 의존성
├── server.js           # Express.js 서버
├── .dockerignore       # Docker 빌드 제외
├── .gitignore          # Git 제외
└── README.md           # 이 파일
```

## 기능

- **POST /ocr**: Base64 이미지 수신 → Google Cloud Vision API 호출 → 텍스트 추출
- **GET /health**: 헬스 체크
- **요청 제한**: 하루 20회 (IP별)

## 배포

### Google Cloud Run 배포 방법

1. GitHub에 이 저장소를 push
2. Google Cloud Console → Cloud Run → 서비스 만들기
3. **배포 설정:**
   - 저장소 선택
   - 분기: `main` 또는 `master`
   - 빌드 유형: "Dockerfile"
   - **Dockerfile 경로: `ocr-proxy/Dockerfile`**
   - **Root directory: `ocr-proxy`**
4. **환경 변수:**
   - `GOOGLE_CLOUD_VISION_API_KEY`: Google Cloud Vision API 키
5. 배포

### 로컬 테스트

```bash
cd ocr-proxy
npm install
GOOGLE_CLOUD_VISION_API_KEY=your-api-key npm start
```

## API

### POST /ocr

**요청:**
```json
{
  "base64Image": "iVBORw0KGgo..."
}
```

**응답 (성공):**
```json
{
  "success": true,
  "text": "9.08 ng/µL\n7.68 ng/µL\n...",
  "numbers": [9.08, 7.68],
  "formattedNumbers": "9.08\n7.68"
}
```

**응답 (실패):**
```json
{
  "success": false,
  "error": "Rate limit exceeded"
}
```

### GET /health

**응답:**
```json
{
  "status": "ok",
  "timestamp": "2026-05-15T03:30:00.000Z"
}
```

## 환경 변수

| 변수 | 설명 | 필수 |
|------|------|------|
| `GOOGLE_CLOUD_VISION_API_KEY` | Google Cloud Vision API 키 | ✓ |
| `PORT` | 서버 포트 (기본값: 8080) | - |

## 비용

- **무료 한도:** 월 200만 요청, 월 50만 GB-초
- **현재 설정:** 하루 20회 요청 제한 (월 600회)
- **예상 비용:** 거의 없음 (무료 한도 내)

## 문제 해결

### 배포 실패: "Dockerfile not found"
- Root directory가 `ocr-proxy`로 설정되어 있는지 확인
- Dockerfile 경로가 `ocr-proxy/Dockerfile`로 설정되어 있는지 확인

### API 호출 실패
- `GOOGLE_CLOUD_VISION_API_KEY` 환경 변수 확인
- Google Cloud Vision API 활성화 여부 확인
- 이미지 크기 확인 (10MB 이하)

### 요청 제한 도달
- 24시간 후 자동 리셋
- Cloud Run 콘솔에서 수동 리셋 가능

## 참고

- [Google Cloud Run 문서](https://cloud.google.com/run/docs)
- [Google Cloud Vision API 문서](https://cloud.google.com/vision/docs)
