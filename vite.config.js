import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/apex-slipstream-from-playabl/" : "/",
});

