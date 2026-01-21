import { createWebDavClient, type WebDavClient } from "@yeying-community/web3-bs";
import { notifyError } from "@/utils/message";
import { getWebDavToken } from "@/plugins/auth";

class StorageClient {
  private client: WebDavClient | null = null;

  private normalizeBase(base?: string) {
    if (!base) return "";
    return base.replace(/\/+$/, "");
  }

  private normalizePrefix(prefix?: string) {
    if (!prefix || prefix === "/") return "";
    let next = prefix.startsWith("/") ? prefix : `/${prefix}`;
    next = next.replace(/\/+$/, "");
    return next;
  }

  private async ensureClient() {
    if (!this.client) {
      const baseUrl = this.normalizeBase(import.meta.env.VITE_WEBDAV_BASE_URL);
      if (!baseUrl) {
        throw new Error("Missing VITE_WEBDAV_BASE_URL");
      }
      const prefix = this.normalizePrefix(import.meta.env.VITE_WEBDAV_PREFIX);
      this.client = createWebDavClient({ baseUrl, prefix });
    }
    const token = await getWebDavToken();
    if (token) {
      this.client.setToken(token);
    }
    return this.client;
  }

  getPublicUrl(filename: string) {
    const baseUrl = this.normalizeBase(import.meta.env.VITE_WEBDAV_BASE_URL);
    const prefix = this.normalizePrefix(import.meta.env.VITE_WEBDAV_PREFIX);
    const fallback = `${baseUrl}${prefix}`;
    const base = this.normalizeBase(import.meta.env.VITE_WEBDAV_PUBLIC_BASE || fallback);
    return `${base}/${encodeURIComponent(filename)}`;
  }

  async uploadFile(file: Blob, filename: string) {
    if (localStorage.getItem("hasConnectedWallet") === "false") {
      notifyError('❌未检测到钱包，请先安装并连接钱包');
      return;
    }
    try {
      const client = await this.ensureClient();
      await client.upload(`/${filename}`, file, file.type || "application/octet-stream");
      return this.getPublicUrl(filename);
    } catch (error) {
      console.error("WebDAV upload failed:", error);
      notifyError(`❌上传失败: ${error}`);
    }
  }
}

export default new StorageClient();
