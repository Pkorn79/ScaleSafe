FROM node:20-alpine AS builder

WORKDIR /app

# Install backend dependencies
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Install frontend dependencies
COPY src/ui/package.json src/ui/package-lock.json* src/ui/
RUN cd src/ui && npm install

# Copy source
COPY tsconfig.json ./
COPY src/ src/

# Build backend
RUN npx tsc

# Build frontend
RUN cd src/ui && npx vite build

# Copy frontend build to dist
RUN mkdir -p dist/ui && cp -r src/ui/dist dist/ui/dist

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
