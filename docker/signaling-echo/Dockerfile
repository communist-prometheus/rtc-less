FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/

EXPOSE 8787

HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD wget -q --spider http://localhost:8787/health || exit 1

CMD ["node", "--experimental-strip-types", "src/server.ts"]
