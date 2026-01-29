# yeying-community-node

YeYing 社区节点服务（Node.js）。提供 REST 接口与 SIWE/UCAN 鉴权。文件存储通过前端使用 `@yeying-community/web3-bs` 的 WebDAV 接口直接访问。

## 主要功能
- REST API（`src/routes` 按 public/admin/internal 分组）
- SIWE 登录 + UCAN 访问控制（Authorization: Bearer `<JWT|UCAN>`）
- WebDAV 存储（前端直连 WebDAV，使用 UCAN 作为 Bearer Token）

## 设计文档
设计文档统一放在 `docs/` 目录下（Markdown + Mermaid），按语言分为：
- `docs/zh`（中文）
- `docs/en`（English）

## 开发与调试

### 环境准备
1. Node.js + npm
2. 配置服务参数
   ```bash
   cp config.json.template config.json
   ```
   常用配置项：
   - `app.env` / `app.port`
   - `auth.jwtSecret` / `auth.accessTtlMs` / `auth.refreshTtlMs` / `auth.challengeTtlMs`
   - `auth.cookieSameSite` / `auth.cookieSecure`
   - `ucan.aud` / `ucan.resource` / `ucan.action`
   - `audit.approvers` / `audit.requiredApprovals`（上架审核人列表与通过阈值）

### 启动开发服务
```bash
npm install
npm run dev
```
默认端口：`http://localhost:8100`

## Docker / Docker Compose（可选）

### Docker
使用已构建的镜像运行（镜像来源可由你的 CI/CD 或镜像仓库提供）：
```bash
docker run --rm \
  -p 8100:8100 \
  -v $(pwd)/config.json:/app/config.json:ro \
  -e APP_CONFIG_PATH=/app/config.json \
  yeying-community-node:latest
```

### Docker Compose
可使用 `docker compose` 启动（示例 `docker-compose.yml` 需自行准备）：
```yaml
services:
  node:
    image: yeying-community-node:latest
    ports:
      - "8100:8100"
    volumes:
      - ./config.json:/app/config.json:ro
    environment:
      - APP_CONFIG_PATH=/app/config.json
```
启动命令：
```bash
docker compose up -d
```

### WebDAV 存储（前端）
当前服务端不再提供上传/下载接口。前端通过 `@yeying-community/web3-bs` 直接访问 WebDAV，并使用登录得到的 UCAN 作为 Bearer Token。

前端常用环境变量（由 Vite 读取）：
- `VITE_WEBDAV_BASE_URL`：WebDAV 基础地址
- `VITE_WEBDAV_PREFIX`：可选前缀路径
- `VITE_WEBDAV_PUBLIC_BASE`：可选公开访问前缀（未设置时回退为 `VITE_WEBDAV_BASE_URL + VITE_WEBDAV_PREFIX`）
- `VITE_WEBDAV_AVATAR`：默认头像路径（可选）

### 前端（可选）
```bash
cd web
npm install
npm run dev
```

# 本地部署
```bash
bash script/runner.sh -e dev
```

# 如果遇到 data 目录无法访问
```bash
sudo chown -R 1001:1001 ./data
```

![alt text](image.png)

![alt text](container.png)

![alt text](images.png)
