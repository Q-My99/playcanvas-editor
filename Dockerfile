FROM ghcr.io/playcanvas/editor/test:latest AS base
COPY --from=oven/bun:1.4.0 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock bunfig.toml /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

FROM base AS builder
COPY --from=install /temp/dev/package.json /temp/dev/bun.lock ./
COPY --from=install /temp/dev/node_modules ./node_modules

# build js + css
COPY src ./src
COPY sass ./sass
COPY static ./static
COPY types.d.ts ./
COPY tsconfig.json ./
COPY vite.config.mjs ./
RUN bun run --bun build

FROM base AS run
COPY --from=install /temp/dev/package.json /temp/dev/bun.lock ./
COPY --from=install /temp/dev/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

CMD ["/bin/bash", "-c", "bun run --bun serve & SERVE_PID=$!; \
    bun run --bun --cwd /usr/src/test test; \
    TEST_EXIT_CODE=$?; \
    kill $SERVE_PID; \
    exit $TEST_EXIT_CODE"]
