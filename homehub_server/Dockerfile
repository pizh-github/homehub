# 小P家事板（HomeHub）运行镜像
#
# 只负责两件事：
#   1. Node.js 22 运行环境
#   2. 固化 Chromium 及其系统依赖（服务端渲染墨水屏帧用）
# 代码不打进镜像，运行时由 docker-compose 挂载（见 docker-compose.yml），
# 因此更新业务代码只需 docker compose restart，无需重新构建。

FROM node:22-bookworm-slim

# 国内构建时下载 Chromium 较慢，可取消下面这行注释加速
# ENV PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright

# 版本需与 package-lock.json 锁定的 playwright 保持一致；升级依赖后请同步修改并重建镜像
RUN npm install -g playwright@1.60.0 \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EXPOSE 8788

CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
