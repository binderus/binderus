import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // React Compiler target matches installed React (19.2.x) — unlocks auto-memoization
    // paths specific to React 19 (25–40% fewer re-renders on sustained updates vs. target "18").
    babel({ presets: [reactCompilerPreset({ target: "19" })] }),
  ],

  // Vite optons tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // prevent vite from obscuring rust errors
  clearScreen: false,
  optimizeDeps: {
    exclude: ["cytoscape"],
  },
  resolve: {
    alias: {
      "cytoscape/dist/cytoscape.umd.js": "cytoscape",
    },
  },
  // tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: true,
  },
  // to make use of `TAURI_DEBUG` and other env variables
  // https://tauri.studio/v1/api/config#buildconfig.beforedevcommand
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Tauri supports es2021
    target: ["es2021", "chrome100", "safari13"],
    // don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        // Manual chunk split: peel big vendors off the main bundle so the entry stays lean.
        // Keep groupings coarse — too many small chunks hurts HTTP/1 and warms-up.
        // Measured target: trim main index-*.js from ~639 KB → ≤ 350 KB.
        // Rolldown 1.0 requires the function form (object form is a Rollup-only API).
        // Match by substring against `id` (the absolute module path) — covers both
        // `node_modules/<pkg>` and `node_modules/.pnpm/<pkg>@ver/node_modules/<pkg>` layouts.
        manualChunks: (id: string) => {
          if (!id.includes("node_modules")) return;

          // Extract the canonical package name from either the regular
          // node_modules/<pkg> path OR the pnpm-virtual
          // node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> path.
          // We grab the last `node_modules/` segment and read the package name after it.
          const lastNm = id.lastIndexOf("node_modules/");
          if (lastNm < 0) return;
          const tail = id.slice(lastNm + "node_modules/".length);
          // Scoped (@scope/name) packages must include 2 segments.
          const pkg = tail.startsWith("@")
            ? tail.split("/").slice(0, 2).join("/")
            : tail.split("/")[0];

          if (pkg === "react" || pkg === "react-dom" || pkg === "react-compiler-runtime") return "vendor-react";

          if (
            pkg === "@milkdown/core" ||
            pkg === "@milkdown/react" ||
            pkg === "@milkdown/prose" ||
            pkg === "@milkdown/preset-commonmark" ||
            pkg === "@milkdown/preset-gfm" ||
            pkg === "@milkdown/theme-nord" ||
            pkg === "@milkdown/utils"
          ) return "vendor-milkdown-core";

          if (pkg.startsWith("@milkdown/plugin-")) return "vendor-milkdown-plugins";

          if (
            pkg === "@floating-ui/react" ||
            pkg === "@headlessui/react" ||
            pkg === "@hello-pangea/dnd" ||
            pkg === "@formkit/auto-animate" ||
            pkg === "react-toastify" ||
            pkg === "react-spinners" ||
            pkg === "react-icons"
          ) return "vendor-ui";

          if (pkg === "zustand" || pkg === "swr" || pkg === "use-pubsub-js") return "vendor-state";
          if (pkg === "axios" || pkg === "query-string" || pkg === "uuid") return "vendor-net";
          if (pkg === "react-intl-universal" || pkg === "react-markdown" || pkg === "remark-gfm") return "vendor-i18n";

          if (pkg === "@tauri-apps/api" || pkg.startsWith("@tauri-apps/plugin-")) return "vendor-tauri";

          return; // default: let the bundler decide
        },
      },
    },
  },
});
