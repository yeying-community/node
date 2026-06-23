# 图表与图片写法

## 推荐方式

当前帮助页已经原生支持：

- Markdown 图片
- Mermaid 流程图
- Mermaid 时序图

这三种已经够覆盖大部分帮助文档场景。

## 插入图片

```md
![登录流程示意图](./images/login-flow.png)
```

## Mermaid 流程图

````md
```mermaid
flowchart LR
  A[开始] --> B[授权]
  B --> C[完成]
```
````

效果：

```mermaid
flowchart LR
  A[开始] --> B[授权]
  B --> C[完成]
```

## Mermaid 时序图

````md
```mermaid
sequenceDiagram
  participant U as 用户
  participant N as Node
  U->>N: 发起请求
  N-->>U: 返回结果
```
````

效果：

```mermaid
sequenceDiagram
  participant U as 用户
  participant N as Node
  U->>N: 发起请求
  N-->>U: 返回结果
```

## PlantUML 怎么接

如果后面你要统一 UML 风格，建议走两种方式之一：

### 方式一：预先生成图片，再在 Markdown 中引用

```md
![授权时序图](./images/auth-sequence.svg)
```

优点：

- 最稳定
- 不依赖浏览器额外解析

缺点：

- 每次改图都要重新生成

### 方式二：通过 PlantUML / Kroki 服务生成图片

```md
![授权时序图](https://kroki.io/plantuml/svg/SoWkIImgAStDuNBAJrBGjLDmpCbCJbMmKiX8pSd9vt98pKi12WC0)
```

优点：

- 可以保留 PlantUML 源码工作流

缺点：

- 依赖外部服务

## 结论

当前项目最适合：

- 说明性文档：Markdown
- 页面内流程图：Mermaid
- 正式 UML 图：PlantUML 导出 SVG 后插图
