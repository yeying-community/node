# Business Workflows (Detailed)

This section describes the core market workflows and key implementation details.

## 1) Application Publish
```mermaid
sequenceDiagram
  actor U as Publisher
  participant FE as Frontend
  participant BE as Backend
  participant DB as Database

  U ->> FE: Fill application form
  FE ->> BE: POST /api/v1/application/create
  BE ->> DB: Save applications (is_online defaults to false)
  BE -->> FE: Success
```

### Notes
- `applications.is_online` is set to `false` on create (`convertApplicationTo`).
- `applications.status` defaults to `BUSINESS_STATUS_PENDING`.
- Approve sets `BUSINESS_STATUS_ONLINE`; reject sets `BUSINESS_STATUS_REJECTED`.

### Application Lifecycle (Target Model)
> Note: `status` + `is_online` are now persisted and driven by `BUSINESS_STATUS_*`.
```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> REVIEWING: submit publish audit
  REVIEWING --> ONLINE: approved
  REVIEWING --> REJECTED: rejected
  ONLINE --> OFFLINE: unpublish
  OFFLINE --> REVIEWING: republish audit
  REJECTED --> REVIEWING: resubmit publish audit
```

## 2) Service Publish
```mermaid
sequenceDiagram
  actor U as Publisher
  participant FE as Frontend
  participant BE as Backend
  participant DB as Database

  U ->> FE: Fill service form
  FE ->> BE: POST /api/v1/service/create
  BE ->> DB: Save services (is_online defaults to false)
  BE -->> FE: Success
```

### Notes
- `services.is_online` is set to `false` on create (`convertServiceTo`).
- `services.status` defaults to `BUSINESS_STATUS_PENDING`.
- Approve sets `BUSINESS_STATUS_ONLINE`; reject sets `BUSINESS_STATUS_REJECTED`.

### Service Lifecycle (Target Model)
```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> REVIEWING: submit publish audit
  REVIEWING --> ONLINE: approved
  REVIEWING --> REJECTED: rejected
  ONLINE --> OFFLINE: unpublish
  OFFLINE --> REVIEWING: republish audit
  REJECTED --> REVIEWING: resubmit publish audit
```

## 3) Apply Flow (Submit/Cancel)
```mermaid
flowchart TD
  A[Applicant submits request]
  B{Validation passed?}
  C[/audit/create]
  D[Create audits ticket]
  E[Enter review queue]
  F{Cancel?}
  G[/audit/cancel]
  H[Delete audits + comments]
  I[Wait for review]
  J[Return error]

  A --> B
  B -- No --> J
  B -- Yes --> C --> D --> E --> F
  F -- Yes --> G --> H
  F -- No --> I
```

### Notes
- Server checks: target exists, applicant is owner, metadata JSON is valid, no open tickets for the same target.
- `/audit/cancel` deletes the ticket and its comments.

## 4) Review Flow (Approve/Reject)
```mermaid
flowchart TD
  A[Reviewer searches tickets
/audit/search]
  B[View detail
/audit/detail]
  C{Decision}
  D[/audit/approve]
  E[/audit/reject]
  F[Write comments]
  G[Target: update resource status]
  H[Notify/log]

  A --> B --> C
  C -- Approve --> D --> F
  C -- Reject --> E --> F
  F -.-> G
  F --> H
```

### Notes
- `comments.status` supports `AGREE` / `REJECT` only.
- Audit decisions are idempotent: once decided, further approvals/rejections are rejected.
- Audit results now toggle `is_online`.

### Audit Ticket State Machine (Logical)
> Note: there is no explicit `status` field; state is inferred from latest comment.
```mermaid
stateDiagram-v2
  [*] --> PENDING: /audit/create
  PENDING --> APPROVED: /audit/approve
  PENDING --> REJECTED: /audit/reject
  PENDING --> CANCELED: /audit/cancel
  REJECTED --> PENDING: resubmit (new ticket)
```

## 5) Publish/Unpublish Flow (Application/Service)
> Note: dedicated publish/unpublish APIs are available (`/application/publish`, `/application/unpublish`, `/service/publish`, `/service/unpublish`).
```mermaid
flowchart TD
  A[Owner requests publish/unpublish]
  B{Operation}
  C{Audit approved?}
  D[Set is_online=true]
  E[Set is_online=false]
  F[Return result]
  G[Reject/Explain]

  A --> B
  B -- Publish --> C
  C -- No --> G
  C -- Yes --> D --> F
  B -- Unpublish --> E --> F
```

### Notes
- Publish requires audit approval; only owner/admin can operate.
- Dedicated publish/unpublish endpoints are available; audit results also toggle online state.
- Search and display unify both audit + online states.

### Online State Machine (Logical)
```mermaid
stateDiagram-v2
  [*] --> OFFLINE: target default
  OFFLINE --> ONLINE: publish
  ONLINE --> OFFLINE: unpublish
```

## 6) Search & Filter Flow
```mermaid
flowchart TD
  A[Search condition]
  B{Has keyword?}
  C[Search by keyword + is_online=true]
  D[Search by name/owner/code]
  E[No condition => is_online=true]

  A --> B
  B -- Yes --> C
  B -- No --> D
  D --> E
```

### Notes
- `is_online=true` is enforced for all search modes (keyword/name/owner/code).

## 7) Auth & Permission
- All business APIs require `Authorization: Bearer <JWT|UCAN>`.
- UCAN `aud` must match server `UCAN_AUD` exactly, otherwise 401.
- Role/status checks and signature verification are **not enforced** (see `permissions.md`).
