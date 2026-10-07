# syntax=docker/dockerfile:1
# ============================================================
# WeftCount · 后端镜像（多阶段）
# ------------------------------------------------------------
# 关键点：
#  1) pnpm workspace 是 monorepo，构建 server 前**必须先构建 shared**
#     （server 依赖 @weftcount/shared 的产物 dist-esm，源码 TS 不能直接跑）
#  2) 只拷必要的 workspace 包，避免把 desktop( Electron ) 也拖进镜像
#  3) 运行阶段只留 production 依赖，镜像更小
# ============================================================

# ---------- 依赖安装层（利用缓存：仅 package.json 变化时重跑） ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# 先只拷清单文件，最大化利用 Docker 层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# nodeLinker: hoisted 是本项目在部分环境的必要适配（见 pnpm-workspace.yaml 注释）
RUN pnpm install --frozen-lockfile --filter @weftcount/server... --filter @weftcount/shared

# ---------- 构建层 ----------
FROM deps AS build
WORKDIR /app
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# shared 先行（CJS + ESM 双格式产物），再构建 server
RUN pnpm --filter @weftcount/shared build \
 && pnpm --filter @weftcount/server build

# ---------- 运行层 ----------
# ---------- 运行层 ----------
# 迁移与 seed 需要 devDependencies（typeorm-cli / ts-node），故沿用 build 层的完整依赖。
# **整体拷贝 /app**，不逐个拷 node_modules：本项目用 nodeLinker: hoisted
# （依赖全部提升到根 node_modules，各包下可能没有自己的 node_modules），
# 逐个 COPY 会因「路径不存在」直接构建失败 —— 这是实测踩过的坑。
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

COPY docker/server-entrypoint.sh /usr/local/bin/server-entrypoint.sh
RUN chmod +x /usr/local/bin/server-entrypoint.sh

EXPOSE 3180
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3180/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/server-entrypoint.sh"]
CMD ["node", "apps/server/dist/main.js"]
