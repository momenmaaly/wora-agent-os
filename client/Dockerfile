FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=""
ARG VITE_SOCKET_URL=""
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}

RUN npm run build

FROM nginx:1.27-alpine AS runner
ENV PORT=80
ENV NGINX_ENVSUBST_FILTER=^PORT$

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx-client.conf /etc/nginx/templates/default.conf.template

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["sh", "-c", "wget -qO- http://127.0.0.1:${PORT:-80}/ >/dev/null || exit 1"]

CMD ["nginx", "-g", "daemon off;"]
