# syntax=docker/dockerfile:1
# ============================================================
# WeftCount · 管理端镜像（构建 + nginx 托管）
# ------------------------------------------------------------
# 关键点：admin 前端用**相对路径 /api**（dev 走 vite 代理）。
# 生产环境用 nginx 把 /api 反代到后端容器，前端代码**无需为容器化做任何改动**，
# 也不必在构建期注入 API 地址（换后端地址无需重新构建镜像）。
# ============================================================

# ---------- 构建 ----------
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/admin/package.json ./apps/admin/

RUN pnpm install --frozen-lockfile --filter @weftcount/admin... --filter @weftcount/shared

COPY packages/shared ./packages/shared
COPY apps/admin ./apps/admin

# admin 依赖 shared 的 ESM 产物（vite alias 指向 dist-esm），故 shared 必须先构建
RUN pnpm --filter @weftcount/shared build \
 && pnpm --filter @weftcount/admin build

# ---------- 运行：nginx 托管静态 + 反代 /api ----------
FROM nginx:1.27-alpine AS runtime

# 构建产物拷进 nginx 的站点根目录（缺失这步 nginx 会返回默认欢迎页）
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html

# 用环境变量注入后端地址，compose 里通过 envsubst 模板化
COPY docker/admin-nginx.conf.template /etc/nginx/templates/default.conf.template
ENV BACKEND_HOST=server:3180
ENV API_PREFIX=/api

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]