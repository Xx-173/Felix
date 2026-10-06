ARG BUN_IMAGE=oven/bun:1
FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts --filter '@finagent/web...' --filter '@finagent/server...'
RUN bun run web:build
RUN bun build apps/server/src/index.ts --target bun --outfile /app/server.js

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 FELIX_DATA_DIR=/data FELIX_STATIC_DIR=/app/public FELIX_SKILLS_DIR=/app/skills
COPY --from=build /app/server.js /app/server.js
COPY --from=build /app/apps/web/dist /app/public
COPY --from=build /app/skills /app/skills
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD bun --no-env-file -e 'const r = await fetch("http://127.0.0.1:8787/healthz"); process.exit(r.ok ? 0 : 1)'
CMD ["bun", "--no-env-file", "server.js"]
