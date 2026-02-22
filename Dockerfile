FROM node:20-alpine

# Install git and gh CLI
RUN apk add --no-cache git github-cli

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files (includes agent configurations via build script)
COPY dist/ ./dist/

# Create logs directory
RUN mkdir -p logs

# Set default environment variables
ENV NODE_ENV=production

# Run the application
CMD ["node", "dist/index.js"]
