FROM node:24-bookworm-slim AS web

WORKDIR /src
RUN npm install --global pnpm@10.34.5
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY packages/daynight/package.json ./packages/daynight/package.json
COPY packages/daynight-web/package.json ./packages/daynight-web/package.json
RUN pnpm install --frozen-lockfile --filter @codetreker/daynight-web...
COPY packages/daynight-web ./packages/daynight-web
RUN pnpm web:build

FROM golang:1.27.2-bookworm AS build

WORKDIR /src/packages/daynight-server
COPY packages/daynight-server/go.mod packages/daynight-server/go.sum ./
RUN go mod download
COPY packages/daynight-server/api ./api
COPY packages/daynight-server/cmd ./cmd
COPY packages/daynight-server/internal ./internal
COPY --from=web /src/packages/daynight-server/internal/webui/dist ./internal/webui/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/daynight-server ./cmd/daynight-server

FROM alpine:3.24

RUN addgroup -S -g 10001 daynight && adduser -S -D -H -u 10001 -G daynight daynight \
    && mkdir -p /var/lib/daynight/storage && chown 10001:10001 /var/lib/daynight/storage
COPY --from=build --chmod=0555 /out/daynight-server /usr/local/bin/daynight-server
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/daynight-server"]
