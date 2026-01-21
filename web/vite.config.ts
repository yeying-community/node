import { fileURLToPath, URL } from "node:url";
import viteCompression from "vite-plugin-compression";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { visualizer } from "rollup-plugin-visualizer";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";

// https://vite.dev/config/
export default defineConfig({
  build: {
    reportCompressedSize: false, // 关闭压缩大小报告（减少内存）
    cssCodeSplit: false, // 禁用 CSS 代码拆分
    minify: "terser",
    sourcemap: false, // 关闭 sourcemap 可以显著减少内存使用
    emptyOutDir: true, // 清空输出目录
    chunkSizeWarningLimit: 150000, // 单位是 KB，默认是 500
    terserOptions: {
      //在生产环境中移除console.log和debugger语句，减少打包后的文件大小。
      compress: {
        drop_console: true,
        drop_debugger: true,
        defaults: false, // 禁用部分压缩优化
      },
    },
    rollupOptions: {
      external: ["vm-browserify", "crypto"], // 排除该模块
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            const lib =
              id &&
              id.split("node_modules/")[1] &&
              id.split("node_modules/")[1].split("/")[0];
            // 只对实际使用的大库分块
            if (
              [
                "@yeying-community",
                "element-plus",
                "ant-design-vue",
                "@ant-design",
              ].includes(lib)
            ) {
              return lib;
            }
            return "vendor";
          }
          // if (id.includes('node_modules')) {
          //   // 将node_modules中的模块单独打包
          //   return id.toString().split('node_modules/')[1].split('/')[0].toString()
          // }
        },
        chunkFileNames: "static/js/[name]-[hash].js",
        entryFileNames: "static/js/[name]-[hash].js",
        assetFileNames(assetInfo) {
          if (assetInfo.name.endsWith(".css")) {
            return "static/css/[name]-[hash].[ext]";
          }
          if (
            ["png", "jpg", "svg", "PNG"].some((ext) =>
              assetInfo.name.endsWith(ext)
            )
          ) {
            return "static/img/[name]-[hash].[ext]";
          }
          if (
            ["ttf", "woff", "woff2"].some((ext) => assetInfo.name.endsWith(ext))
          ) {
            return "static/fonts/[name]-[hash].[ext]";
          }
          return "static/css/[name]-[hash].[ext]";
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["vm-browserify", "crypto"], // 不预构建
  },
  plugins: [
    // nodePolyfills({globals: {Buffer: true}}),
    viteCompression({
      verbose: true,
      disable: false,
      threshold: 10240, //超10k压缩
      deleteOriginFile: false,
      algorithm: "gzip",
      ext: ".gz",
    }),
    vue(),
    // vueDevTools(),
    visualizer({
      open: false, // 打包完成后自动打开分析页面
      gzipSize: true, // 显示gzip压缩后的大小
      brotliSize: true, // 显示brotli压缩后的大小
    }),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      crypto: fileURLToPath(new URL("./src/shims/crypto.ts", import.meta.url)),
    },
  },
  // 配置前端服务地址和端口,默认端口是5173 开发机:47.116.193.171:8451 /registry /whoami
  server: {
    host: "0.0.0.0",
    port: 8991,
    proxy: {
      // 代理规则示例2：复杂路径代理
      '/api': {
        target: 'http://localhost:8001', // 本地后端服务
        changeOrigin: true
      }
    },
  },
});
