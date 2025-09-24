FROM rust:1-bullseye AS builder
WORKDIR /app

# 复制源码并构建发布二进制
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
WORKDIR /app

# 安装 CA 证书与时区数据，保证 HTTPS 与正确时区
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# 复制二进制与静态资源
COPY --from=builder /app/target/release/caiyun-weather-rust /app/server
COPY static ./static

# 默认监听 0.0.0.0:8000，可通过环境变量覆盖
ENV HOST=0.0.0.0
ENV PORT=8000
ENV RUST_LOG=info
EXPOSE 8000

# 使用非 root 用户运行
RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app
USER appuser

CMD ["/app/server"]


