# yeying-community-node

YeYing 社区节点服务（Node.js）。提供 REST 接口与 SIWE/UCAN 鉴权。文件存储通过前端使用 `@yeying-community/web3-bs` 的 WebDAV 接口直接访问。

## 主要功能
- REST API（`src/routes` 按 public/admin/internal 分组）
- SIWE 登录 + UCAN 访问控制（Authorization: Bearer `<JWT|UCAN>`）
- WebDAV 存储（前端直连 WebDAV，使用 UCAN 作为 Bearer Token）

## 设计文档
设计文档统一放在 `docs/` 目录下（Markdown + Mermaid），当前仅保留中文版本。入口见 `docs/README.md`。

## 快速启动（前后端）

建议使用两个终端分别启动后端与前端。

后端（终端 1）：
```bash
cp config.js.template config.js
npm install
npm run dev
```
默认端口：`http://localhost:8100`

常用配置项（`config.js`）：
- `app.env` / `app.port`
- `auth.jwtSecret` / `auth.accessTtlMs` / `auth.refreshTtlMs` / `auth.challengeTtlMs`
- `auth.cookieSameSite` / `auth.cookieSecure`
- `ucan.aud` / `ucan.with` / `ucan.can`
- `audit.approvers` / `audit.requiredApprovals`（上架审核人列表与通过阈值）

前端（终端 2）：
```bash
cd web
cp .env.template .env
npm install
npm run dev
```
默认地址：`http://localhost:5173`

`web/.env` 里最关键的是：
- `VITE_NODE_API_ENDPOINT=http://localhost:8100`
- `VITE_WEBDAV_BASE_URL=<你的 WebDAV 地址>`

其余 UCAN 相关变量默认可不填：
- API 默认从 `VITE_NODE_API_ENDPOINT` 推导 audience，并使用 `app:all:<当前前端 host> + invoke`
- WebDAV 默认从 `VITE_WEBDAV_BASE_URL` 推导 audience，并使用 `app:all:<当前前端 host> + write`

### WebDAV 存储
当前服务端不再提供上传/下载接口。前端通过 `@yeying-community/web3-bs` 直接访问 WebDAV，并使用登录得到的 UCAN 作为 Bearer Token。

前端常用环境变量（由 Vite 读取）：
- `VITE_WEBDAV_BASE_URL`：WebDAV 基础地址
- `VITE_WEBDAV_PREFIX`：可选前缀路径
- `VITE_WEBDAV_PUBLIC_BASE`：可选公开访问前缀（未设置时回退为 `VITE_WEBDAV_BASE_URL + VITE_WEBDAV_PREFIX`）
- `VITE_WEBDAV_AVATAR`：默认头像路径（可选）

![alt text](image.png)

![alt text](container.png)

![alt text](images.png)
