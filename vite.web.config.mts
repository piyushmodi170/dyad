import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ReactCompilerConfig = {};

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    strictPort: true,
    allowedHosts: "all",
    hmr: {
      host: process.env.REPLIT_DEV_DOMAIN,
      clientPort: 443,
      protocol: "wss",
    },
    watch: {
      ignored: ["**/.local/**", "**/node_modules/**"],
    },
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/github-proxy/device/code": {
        target: "https://github.com",
        changeOrigin: true,
        rewrite: () => "/login/device/code",
      },
      "/github-proxy/access-token": {
        target: "https://github.com",
        changeOrigin: true,
        rewrite: () => "/login/oauth/access_token",
      },
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
    "__REPLIT_ANTHROPIC_KEY__": JSON.stringify(process.env.ANTHROPIC_API_KEY ?? ""),
    "__REPLIT_OPENAI_KEY__": JSON.stringify(process.env.OPENAI_API_KEY ?? ""),
    "__REPLIT_GOOGLE_KEY__": JSON.stringify(process.env.GOOGLE_API_KEY ?? ""),
  },
});
