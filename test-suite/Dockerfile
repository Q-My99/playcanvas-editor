FROM mcr.microsoft.com/playwright:v1.59.1-noble AS base
COPY --from=oven/bun:1.4.0 /usr/local/bin/bun /usr/local/bin/bun
LABEL org.opencontainers.image.source=https://github.com/playcanvas/editor
WORKDIR /usr/src/test

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock bunfig.toml /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

FROM base AS run
COPY --from=install /temp/dev/node_modules ./node_modules
COPY src ./src
COPY lib ./lib
COPY test ./test
COPY globals.d.ts ./
COPY playwright.config.mjs ./
COPY package.json bun.lock ./
COPY tsconfig.json ./

ENV CI=true
CMD ["bun", "run", "--bun", "test"]