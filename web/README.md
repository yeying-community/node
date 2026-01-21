## 安装包

```sh
npm install
```

### 配置环境变量

```sh
cp .env.template .env
```

> 主要变量说明：
> - `VITE_API_ENDPOINT`：Node 服务地址
> - `VITE_APPLICANT`：默认申请人地址（用于界面显示）
> - `VITE_UCAN_AUD`：UCAN 受众（可选，默认由 `VITE_API_ENDPOINT` 推导）
> - `VITE_UCAN_RESOURCE` / `VITE_UCAN_ACTION`：UCAN 能力（可选，默认 `profile/read`）
> - `VITE_WEBDAV_BASE_URL`：WebDAV 基础地址
> - `VITE_WEBDAV_PREFIX`：WebDAV 前缀路径（可选）
> - `VITE_WEBDAV_AUD`：WebDAV 受众（可选，默认由 `VITE_WEBDAV_BASE_URL` 推导）
> - `VITE_WEBDAV_PUBLIC_BASE`：公开访问前缀（可选，未设置时回退为 `BASE_URL + PREFIX`）
> - `VITE_WEBDAV_AVATAR`：默认头像路径或 URL（可选）

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
