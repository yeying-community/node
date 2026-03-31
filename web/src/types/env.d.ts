// TypeScript 不认识 import.meta.env
// 为 import.meta.env 添加类型声明
interface ImportMetaEnv {
  readonly VITE_NODE_API_ENDPOINT?: string
  readonly VITE_WEBDAV_BASE_URL: string
  readonly VITE_WEBDAV_PREFIX?: string
  readonly VITE_WEBDAV_PUBLIC_BASE?: string
  readonly VITE_WEBDAV_AVATAR?: string
  readonly VITE_WEBDAV_AUD?: string
  readonly VITE_UCAN_AUD?: string
  readonly VITE_UCAN_APP_ID?: string
  readonly VITE_UCAN_WITH?: string
  readonly VITE_UCAN_CAN?: string
  readonly VITE_WEBDAV_UCAN_WITH?: string
  readonly VITE_WEBDAV_UCAN_CAN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
