# Cloud Run용 OCR 프록시 서버 Dockerfile
# Node 20 기반 경량 이미지

FROM node:20-slim

WORKDIR /app

# package.json 복사
COPY package.json .

# 의존성 설치 (프로덕션 모드)
RUN npm install --production

# 서버 코드 복사
COPY server.js .

# 포트 설정
EXPOSE 8080

# Cloud Run은 PORT 환경변수를 자동으로 설정
# server.js에서 process.env.PORT || 8080 사용
CMD ["node", "server.js"]
