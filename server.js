/**
 * Google Cloud Run OCR 프록시 서버
 *
 * 역할:
 * 1. Expo Go 앱에서 Base64 이미지 수신
 * 2. Google Cloud Vision API 호출 (API 키 사용)
 * 3. 추출된 텍스트 및 숫자 반환
 *
 * 배포: Google Cloud Console → Cloud Run
 * 환경변수: GOOGLE_CLOUD_VISION_API_KEY
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 요청 제한 (간단한 구현)
const requestCounts = new Map();
const MAX_REQUESTS_PER_DAY = 20;
const RESET_INTERVAL = 24 * 60 * 60 * 1000; // 24시간

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(clientIP) {
  const now = Date.now();
  const key = `${clientIP}`;

  if (!requestCounts.has(key)) {
    requestCounts.set(key, { count: 0, resetTime: now + RESET_INTERVAL });
  }

  const data = requestCounts.get(key);

  // 리셋 시간이 지났으면 초기화
  if (now > data.resetTime) {
    data.count = 0;
    data.resetTime = now + RESET_INTERVAL;
  }

  data.count++;

  return {
    allowed: data.count <= MAX_REQUESTS_PER_DAY,
    remaining: Math.max(0, MAX_REQUESTS_PER_DAY - data.count),
    total: MAX_REQUESTS_PER_DAY,
  };
}

// 농도 값 추출 (정규식)
function extractConcentrationNumbers(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // ng/ul 계열 단위 앞의 숫자만 추출
  // 패턴: 숫자 (선택: 소수점) + 공백 + ng + / + [uµμ]l
  const pattern = /(\d+(?:\.\d+)?)\s*ng\s*\/\s*[uµμ]l/gi;
  const matches = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    matches.push(parseFloat(match[1]));
  }

  return matches;
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * OCR 엔드포인트
 * POST /ocr
 *
 * 요청:
 * {
 *   "base64Image": "/9j/4AAQ..." (순수 base64, data:image/jpeg;base64, prefix 제거)
 * }
 *
 * 응답:
 * {
 *   "success": true,
 *   "text": "9.08 ng/µL\n7.68 ng/µL\n...",
 *   "numbers": [9.08, 7.68, ...]
 * }
 */
app.post('/ocr', async (req, res) => {
  try {
    const clientIP = getClientIP(req);
    console.log(`[OCR] Request from ${clientIP}`);

    // 요청 제한 확인
    const rateLimit = checkRateLimit(clientIP);
    if (!rateLimit.allowed) {
      console.log(`[OCR] Rate limit exceeded for ${clientIP}`);
      return res.status(429).json({
        success: false,
        error: `Rate limit exceeded. Max ${MAX_REQUESTS_PER_DAY} requests per day.`,
      });
    }

    console.log(`[OCR] Requests remaining: ${rateLimit.remaining}/${rateLimit.total}`);

    let { base64Image } = req.body;

    // 입력 검증
    if (!base64Image || typeof base64Image !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'base64Image is required and must be a string',
      });
    }

    // data:image/jpeg;base64, prefix 제거
    if (base64Image.includes(',')) {
      console.log('[OCR] Detected data URI prefix, removing...');
      base64Image = base64Image.split(',')[1];
    }

    // 로깅: base64 길이 및 시작 부분
    console.log(`[OCR] Base64 image length: ${base64Image.length} bytes`);
    console.log(`[OCR] Base64 image starts with: ${base64Image.substring(0, 50)}...`);

    // Base64 유효성 검증
    if (!/^[A-Za-z0-9+/=]+$/.test(base64Image)) {
      console.error('[OCR] Invalid Base64 format detected');
      return res.status(400).json({
        success: false,
        error: 'Invalid Base64 format',
      });
    }

    if (base64Image.length > 10 * 1024 * 1024) {
      // 10MB 제한
      return res.status(400).json({
        success: false,
        error: 'Image too large (max 10MB)',
      });
    }

    // API 키 확인
    const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    if (!apiKey) {
      console.error('[OCR] GOOGLE_CLOUD_VISION_API_KEY not set');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error',
      });
    }

    console.log('[OCR] Calling Google Cloud Vision API...');

    // Google Cloud Vision API 호출
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: base64Image,
              },
              features: [
                {
                  type: 'TEXT_DETECTION',
                  maxResults: 100,
                },
              ],
            },
          ],
        }),
      }
    );

    console.log('[OCR] Vision API response status:', visionResponse.status);

    if (!visionResponse.ok) {
      const errorData = await visionResponse.json();
      console.error('[OCR] Vision API error:', errorData);
      return res.status(500).json({
        success: false,
        error: `Vision API error: ${visionResponse.status}`,
      });
    }

    const visionData = await visionResponse.json();
    console.log('[OCR] Vision API response received');

    // 응답 검증
    if (!visionData.responses || !visionData.responses[0]) {
      console.error('[OCR] Invalid Vision API response');
      return res.status(500).json({
        success: false,
        error: 'Invalid Vision API response',
      });
    }

    const responseData = visionData.responses[0];

    // 에러 확인
    if (responseData.error) {
      console.error('[OCR] Vision API returned error:', responseData.error);
      return res.status(500).json({
        success: false,
        error: `Vision API error: ${responseData.error.message}`,
      });
    }

    // 텍스트 추출
    if (!responseData.textAnnotations || responseData.textAnnotations.length === 0) {
      console.log('[OCR] No text detected in image');
      return res.json({
        success: true,
        text: '',
        numbers: [],
      });
    }

    const extractedText = responseData.textAnnotations[0].description || '';
    console.log('[OCR] Text extracted, length:', extractedText.length);
    console.log('[OCR] Extracted text preview:', extractedText.substring(0, 200));

    // 농도 값 추출
    const numbers = extractConcentrationNumbers(extractedText);
    console.log('[OCR] Numbers extracted:', numbers);

    // 숫자만 세로 1열로 정렬
    const numbersText = numbers.map((n) => n.toString()).join('\n');

    res.json({
      success: true,
      text: extractedText,
      numbers: numbers,
      formattedNumbers: numbersText,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[OCR] Server error:', errorMessage);

    res.status(500).json({
      success: false,
      error: `Server error: ${errorMessage}`,
    });
  }
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
  });
});

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: 'Internal server error',
  });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`[SERVER] OCR Proxy listening on port ${PORT}`);
  console.log(`[SERVER] Health check: GET /health`);
  console.log(`[SERVER] OCR endpoint: POST /ocr`);
  console.log(`[SERVER] Rate limit: ${MAX_REQUESTS_PER_DAY} requests per 24 hours`);
});
