## 快速启动

```sh
cp .env.template .env
npm install
npm run dev
```

最小配置只需要：

```sh
VITE_NODE_API_ENDPOINT=http://localhost:8100
VITE_WEBDAV_BASE_URL=https://webdav.example.com
```

可选高级项：
- `VITE_UCAN_AUD`：API 的 audience；默认由 `VITE_NODE_API_ENDPOINT` 推导
- `VITE_UCAN_WITH` / `VITE_UCAN_CAN`：API 的 UCAN 能力；默认 `app:all:<当前前端 host> + invoke`
- `VITE_UCAN_APP_ID`：覆盖默认 appId（默认取当前前端 host）
- `VITE_WEBDAV_PREFIX`：WebDAV 子路径前缀
- `VITE_WEBDAV_AUD`：WebDAV audience；默认由 `VITE_WEBDAV_BASE_URL` 推导
- `VITE_WEBDAV_UCAN_WITH` / `VITE_WEBDAV_UCAN_CAN`：WebDAV 的 UCAN 能力；默认 `app:all:<当前前端 host> + write`
- `VITE_WEBDAV_PUBLIC_BASE`：公开访问前缀（未设置时回退为 `BASE_URL + PREFIX`）
- `VITE_WEBDAV_AVATAR`：默认头像路径或 URL（可选）

> 说明：上架审核人/通过阈值在后端 `config.js` 的 `audit.approvers` / `audit.requiredApprovals` 中配置。

### 打生产包

```sh
npm run build
```

### 测试
```sh
npm run test
```
