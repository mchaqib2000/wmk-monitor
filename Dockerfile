FROM node:20-bullseye-slim

WORKDIR /app

# Install build dependencies for better-sqlite3 (native C++ module)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

ENV PORT=3000

CMD ["node", "server/index.js"]
