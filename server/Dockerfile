# Multi-stage build with cargo-chef for cached dependency layers.
#
# NOTE: build from the *repo root* as context (not server/), because build.rs
# compiles the shared contract at ../proto:
#   docker build -f server/Dockerfile -t flag-geo-server .
# (deploy.ps1 already does this.) protoc itself is vendored via the
# protoc-bin-vendored build-dependency, so no system protobuf compiler is needed.
FROM rust:1-slim AS chef
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && cargo install cargo-chef --locked
WORKDIR /app/server

# Plan: capture just the dependency graph so it can be cooked independently of
# the source.
FROM chef AS planner
COPY server/ /app/server/
COPY proto/ /app/proto/
RUN cargo chef prepare --recipe-path recipe.json

# Build: cook dependencies (cached unless Cargo.toml/lock change), then the app.
FROM chef AS builder
COPY --from=planner /app/server/recipe.json /app/server/recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY server/ /app/server/
COPY proto/ /app/proto/
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN useradd -m -u 10001 app && mkdir -p /data && chown app /data
WORKDIR /data
COPY --from=builder /app/server/target/release/flag-geo-server /usr/local/bin/flag-geo-server
USER app
ENV PORT=8080 DB_PATH=/data/flag-geo.db RUST_LOG=info
EXPOSE 8080
ENTRYPOINT ["flag-geo-server"]
