import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 3333
  },
  publicDir: 'public'
});
