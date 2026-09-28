FROM node:20-alpine

# better-sqlite3 needs build tools for its native addon
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

# SQLite data dir (mount a volume here in k8s)
RUN mkdir -p /data
ENV DB_PATH=/data/trips.db
ENV PORT=3000

EXPOSE 3000
CMD ["node", "server.js"]
