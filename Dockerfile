# --- deps stage ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# --- runner stage ---
FROM node:20-alpine AS runner

RUN addgroup -S chatsafe && adduser -S chatsafe -G chatsafe

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY server.js ./
COPY static/ ./static/

USER chatsafe

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8000/health || exit 1

CMD ["node", "server.js"]
