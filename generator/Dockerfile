FROM golang:1.25.5-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o /out/loadlab-agent ./cmd/loadlab-agent

FROM grafana/k6:2.2.0
USER root
COPY --from=builder /out/loadlab-agent /usr/local/bin/loadlab-agent
RUN mkdir -p /tmp/loadlab && chown -R 12345:12345 /tmp/loadlab
USER 12345
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/loadlab-agent"]
