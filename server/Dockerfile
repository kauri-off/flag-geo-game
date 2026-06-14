# Multi-stage build with cargo-chef for cached dependency layers.
FROM rust:1-slim AS chef
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && cargo install cargo-chef --locked
WORKDIR /app

# Plan: capture just the dependency graph so it can be cooked independently of
# the source.
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# Build: cook dependencies (cached unless Cargo.toml/lock change), then the app.
FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN useradd -m -u 10001 app && mkdir -p /data && chown app /data
WORKDIR /data
COPY --from=builder /app/target/release/flag-geo-server /usr/local/bin/flag-geo-server
USER app
ENV PORT=8080 DB_PATH=/data/flag-geo.db RUST_LOG=info
EXPOSE 8080
ENTRYPOINT ["flag-geo-server"]
