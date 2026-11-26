FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY backend/go.mod ./
COPY backend/ ./
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /stokvel-api ./cmd/api/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /stokvel-api .
CMD ["./stokvel-api"]
