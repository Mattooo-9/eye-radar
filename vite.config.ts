import { execSync } from "node:child_process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const resolveReleaseSha = (env: Record<string, string>): string => {
  const fromEnv =
    env.VITE_RELEASE_SHA ||
    process.env.VITE_RELEASE_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.RENDER_GIT_COMMIT;
  if (fromEnv && fromEnv.trim().length >= 7) {
    return fromEnv.trim();
  }
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim();
  } catch {
    return "unknown";
  }
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const releaseSha = resolveReleaseSha(env);

  return {
    plugins: [
      react(),
      {
        name: "eye-radar-release-meta",
        transformIndexHtml(html) {
          const metaTag = `<meta name="eye-radar-release" content="${releaseSha}" />`;
          return html.includes('name="eye-radar-release"')
            ? html
            : html.replace("</head>", `    ${metaTag}\n  </head>`);
        }
      }
    ],
    server: {
      host: "0.0.0.0",
      port: Number(env.CLIENT_PORT || 5173)
    },
    build: {
      outDir: "dist/client",
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            map: ["maplibre-gl"]
          }
        }
      }
    },
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __RELEASE_SHA__: JSON.stringify(releaseSha)
    }
  };
});
