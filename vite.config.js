import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
    build: {
        chunkSizeWarningLimit: 10000,
        rollupOptions: {
            output: {
                manualChunks: id => {
                    if (id.includes("node_modules"))
                        return "vendor";
                }
            }
        }
    },
    plugins: [
        nodePolyfills({
            include: ["buffer"]
        })
    ]
})