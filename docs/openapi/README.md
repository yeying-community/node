# OpenAPI 接口规范

本目录保存 YeYing Node API 的机器可读接口规范：

- `node.openapi.yaml`：OpenAPI 3.1 生成文件，可导入 Swagger UI、Postman、Insomnia 或代码生成工具。

`node.openapi.yaml` 由 `scripts/generate-openapi.cjs` 统一生成，请勿直接修改。接口发生变化后，在仓库根目录执行：

```bash
npm run openapi:generate
```

提交前可检查生成文件是否与脚本一致：

```bash
npm run openapi:check
```

新增或修改接口时，应同步更新生成脚本中的路径、鉴权方式、请求结构和响应结构，随后重新生成规范文件。
