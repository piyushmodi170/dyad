// vite.web.config.mts
import path from "path";
import tailwindcss from "file:///home/runner/workspace/node_modules/@tailwindcss/vite/dist/index.mjs";
import react from "file:///home/runner/workspace/node_modules/@vitejs/plugin-react/dist/index.js";
import { defineConfig } from "file:///home/runner/workspace/node_modules/vite/dist/node/index.js";
var __vite_injected_original_dirname = "/home/runner/workspace";
var ReactCompilerConfig = {};
var vite_web_config_default = defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]]
      }
    }),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5e3,
    allowedHosts: true,
    strictPort: true,
    watch: {
      ignored: ["**/.local/**", "**/node_modules/**"]
    }
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("development")
  }
});
export {
  vite_web_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS53ZWIuY29uZmlnLm10cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9ob21lL3J1bm5lci93b3Jrc3BhY2VcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL3J1bm5lci93b3Jrc3BhY2Uvdml0ZS53ZWIuY29uZmlnLm10c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9ydW5uZXIvd29ya3NwYWNlL3ZpdGUud2ViLmNvbmZpZy5tdHNcIjtpbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gXCJAdGFpbHdpbmRjc3Mvdml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcblxuY29uc3QgUmVhY3RDb21waWxlckNvbmZpZyA9IHt9O1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbXG4gICAgcmVhY3Qoe1xuICAgICAgYmFiZWw6IHtcbiAgICAgICAgcGx1Z2luczogW1tcImJhYmVsLXBsdWdpbi1yZWFjdC1jb21waWxlclwiLCBSZWFjdENvbXBpbGVyQ29uZmlnXV0sXG4gICAgICB9LFxuICAgIH0pLFxuICAgIHRhaWx3aW5kY3NzKCksXG4gIF0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogXCIwLjAuMC4wXCIsXG4gICAgcG9ydDogNTAwMCxcbiAgICBhbGxvd2VkSG9zdHM6IHRydWUsXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcbiAgICB3YXRjaDoge1xuICAgICAgaWdub3JlZDogW1wiKiovLmxvY2FsLyoqXCIsIFwiKiovbm9kZV9tb2R1bGVzLyoqXCJdLFxuICAgIH0sXG4gIH0sXG4gIGRlZmluZToge1xuICAgIFwicHJvY2Vzcy5lbnYuTk9ERV9FTlZcIjogSlNPTi5zdHJpbmdpZnkoXCJkZXZlbG9wbWVudFwiKSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUE4UCxPQUFPLFVBQVU7QUFDL1EsT0FBTyxpQkFBaUI7QUFDeEIsT0FBTyxXQUFXO0FBQ2xCLFNBQVMsb0JBQW9CO0FBSDdCLElBQU0sbUNBQW1DO0FBS3pDLElBQU0sc0JBQXNCLENBQUM7QUFFN0IsSUFBTywwQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLE1BQ0osT0FBTztBQUFBLFFBQ0wsU0FBUyxDQUFDLENBQUMsK0JBQStCLG1CQUFtQixDQUFDO0FBQUEsTUFDaEU7QUFBQSxJQUNGLENBQUM7QUFBQSxJQUNELFlBQVk7QUFBQSxFQUNkO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixjQUFjO0FBQUEsSUFDZCxZQUFZO0FBQUEsSUFDWixPQUFPO0FBQUEsTUFDTCxTQUFTLENBQUMsZ0JBQWdCLG9CQUFvQjtBQUFBLElBQ2hEO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sd0JBQXdCLEtBQUssVUFBVSxhQUFhO0FBQUEsRUFDdEQ7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
