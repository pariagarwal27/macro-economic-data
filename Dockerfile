# Multi-stage Dockerfile for Next.js + SQLite Background Worker
FROM node:20-slim AS builder

WORKDIR /app

# Install python & build tools for native packages if needed
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Production runner image
FROM node:20-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y python3 python3-venv ca-certificates chromium && rm -rf /var/lib/apt/lists/*
COPY Economic_calendar/requirements.txt /tmp/calendar-requirements.txt
RUN python3 -m venv /opt/calendar-python && /opt/calendar-python/bin/pip install --no-cache-dir -r /tmp/calendar-requirements.txt
ENV PYTHON_COMMAND=/opt/calendar-python/bin/python
ENV CALENDAR_DB_PATH=/app/data/economic_calendar.db
ENV PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_NO_SANDBOX=1

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=10000

# Copy node_modules and built app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts

# Copy database directories
COPY --from=builder /app/data ./data
COPY --from=builder /app/Economic_calendar ./Economic_calendar

EXPOSE 10000

# Start both Next.js and the background release ingestion worker
CMD ["npm", "run", "start:all"]
