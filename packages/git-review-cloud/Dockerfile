FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-package-lock
COPY tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S app && adduser -S app -u 1001
COPY package.json ./
RUN npm install --omit=dev --no-package-lock
COPY --from=builder /app/dist ./dist
COPY web ./web
USER app
EXPOSE 8080
CMD ["node", "dist/main.js"]
