FROM node:22-alpine
RUN apk add --no-cache chromium ca-certificates tini \
  && adduser -D -u 10001 -h /home/wora wora || true
WORKDIR /app
COPY dist/browser-runner.mjs /app/browser-runner.mjs
COPY node_modules/playwright-core /app/node_modules/playwright-core
ENV WORA_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV HOME=/tmp
ENTRYPOINT ["/sbin/tini", "--", "node", "/app/browser-runner.mjs"]
