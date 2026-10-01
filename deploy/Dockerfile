# syntax=docker/dockerfile:1.7
#
# Flux Atlas v2 container: one static binary (API, live WebSocket and the embedded web app) and
# one data directory. Build from the repository root:
#
#   docker build -f deploy/Dockerfile -t flux-atlas:dev .
#
# The Flux app spec passes no environment variables and no commands, so the defaults set here
# are the production configuration. See docs/ARCHITECTURE.md section 11.

ARG RUST_IMAGE=rust:1.97-alpine3.22
ARG NODE_IMAGE=node:26-alpine3.22

# 1. Web app: `npm ci` from the pinned lockfile, then the production build into web/dist.
FROM ${NODE_IMAGE} AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
# Source maps are for development; they would add about 6 MB to the binary.
RUN npm run build && find dist -name '*.map' -delete

# 2. Server: a fully static musl build of `atlas` that embeds web/dist (rust-embed reads the
#    directory at compile time). mimalloc is the global allocator, so musl's malloc is not on
#    the hot path.
FROM ${RUST_IMAGE} AS server
RUN apk add --no-cache musl-dev cmake make perl ca-certificates
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY --from=web /src/web/dist web/dist
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p atlas-server --bin atlas \
    && install -D -m 0755 target/release/atlas /out/atlas
# The data directory exists in the image so a run without a volume still works.
RUN mkdir -p /out/app/backend/data

# 3. Runtime: nothing but the binary, the CA bundle (rustls verifies upstream TLS against the
#    system store) and the data directory. No shell, no package manager, no libc to patch.
FROM scratch
COPY --from=server /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=server /out/atlas /usr/local/bin/atlas
COPY --from=server /out/app /app

# FluxOS bind-mounts the app volume at containerData. The host directory is owned by root and
# not writable by other users, so the server runs as root inside the container (there is no
# shell or other binary in the image to escalate with). At startup `atlas serve` drops every
# capability and sets no_new_privs itself, since the spec cannot pass --cap-drop. See
# ARCHITECTURE sections 11 and 11.2.
USER 0:0
WORKDIR /app

ENV ATLAS_BIND=0.0.0.0:3000 \
    ATLAS_DATA_DIR=/app/backend/data \
    ATLAS_LOG=info \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

VOLUME ["/app/backend/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["/usr/local/bin/atlas", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/atlas"]
CMD ["serve"]
