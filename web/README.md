## 安装包

```sh
npm install
```

### 配置环境变量

```sh
cp .env.template .env
```

> 主要变量说明：
> - `VITE_NODE_API_ENDPOINT`：Node 服务地址（设置后 API 请求使用该 base；未设置则使用同源 `/api/*`）
> - `VITE_UCAN_AUD`：UCAN 受众（可选，默认由 `VITE_NODE_API_ENDPOINT` 推导）
> - `VITE_UCAN_RESOURCE` / `VITE_UCAN_ACTION`：UCAN 能力（可选，默认 `profile/read`）
> - `VITE_WEBDAV_BASE_URL`：WebDAV 基础地址
> - `VITE_WEBDAV_PREFIX`：WebDAV 前缀路径（可选）
> - `VITE_WEBDAV_AUD`：WebDAV 受众（可选，默认由 `VITE_WEBDAV_BASE_URL` 推导）
> - `VITE_WEBDAV_PUBLIC_BASE`：公开访问前缀（可选，未设置时回退为 `BASE_URL + PREFIX`）
> - `VITE_WEBDAV_AVATAR`：默认头像路径或 URL（可选）

> 说明：上架审核人/通过阈值在后端 `config.json` 的 `audit.approvers` / `audit.requiredApprovals` 中配置。

### 启动开发环境

```sh
npm run dev
```

### 打生产包

```sh
npm run build
```

### 测试
```sh
npm run test
```
