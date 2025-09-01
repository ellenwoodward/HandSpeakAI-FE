# Use Node 20
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app code
COPY . .

# Build Next.js frontend
RUN npx next build

# Expose Cloud Run port
EXPOSE 8080

# Start custom server
CMD ["node", "server.js"]
