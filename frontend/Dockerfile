FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./

# Copy source
COPY . .

CMD ["sh", "-c", "npm ci && npm run dev -- --host"]
