# 第一阶段：构建阶段
FROM node:24 AS builder

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装所有依赖
RUN npm ci

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 安装并重新构建生产依赖（确保原生模块正确编译）
RUN npm ci --only=production

# 第二阶段：运行阶段
FROM node:24-alpine AS runtime

# 只安装运行时必需的包
RUN apk add --no-cache bash sqlite

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

# 从构建阶段复制所有必要文件
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nextjs:nodejs /app/script ./script

# 确保启动脚本有执行权限
RUN chmod +x script/startService.sh
