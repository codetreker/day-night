FROM golang:1.27.2-bookworm AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY api ./api
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/daynight-server ./cmd/daynight-server

FROM alpine:3.24

RUN addgroup -S -g 10001 daynight && adduser -S -D -H -u 10001 -G daynight daynight
COPY --from=build --chmod=0555 /out/daynight-server /usr/local/bin/daynight-server
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/daynight-server"]
