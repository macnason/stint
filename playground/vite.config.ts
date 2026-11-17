import { defineConfig } from "vite";

const allowedHosts = process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
  ?.split(",")
  .filter(Boolean);

export default defineConfig({
  root: import.meta.dirname,
  oxc: {
    jsx: { runtime: "automatic" },
  },
  server: {
    host: "127.0.0.1",
    allowedHosts,
  },
});
