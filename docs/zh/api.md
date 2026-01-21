# API 概览

## 基础路径
`/api/v1`

## 响应封装
所有响应遵循统一结构：
```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "timestamp": 1730000000000
}
```

## 鉴权
- 公共认证接口：`/api/v1/public/auth/*`
- 其余接口需要 `Authorization: Bearer <JWT|UCAN>`

## 模块分组（常见）
- **Application**: create/detail/search/delete
- **Service**: create/detail/search/delete
- **Audit/Approval**: create/search/approve/reject/cancel/detail
- **User/Profile/Node**: 基础信息与健康检查

> 完整接口列表参见 `openapi.json` 或在 `APP_ENV=dev` 访问 `/api-docs`。

## 存储
后端存储接口已弃用，前端通过 WebDAV 直连上传。
