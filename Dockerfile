FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# Served at admin.lovepop.com/ambassador; the page reads the prefix from the server at runtime.
ENV BASE_PATH=/ambassador
ARG GIT_SHA=dev
ENV APP_COMMIT=$GIT_SHA
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
