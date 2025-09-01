# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for TypeScript and Next.js)
RUN npm ci

# Copy source code
COPY . .

# Build production Next.js app, ignore ESLint errors
RUN npx next build --no-lint

# Stage 2: Production image
FROM node:20-alpine AS runner
WORKDIR /app

# Copy production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built app from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/app ./app   # copy the app folder from src

# Expose Cloud Run port
ENV PORT 8080
EXPOSE 8080

# Start production server
CMD ["npx", "next", "start", "-p", "8080"]
