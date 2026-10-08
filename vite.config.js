import { defineConfig } from 'vite';

export default defineConfig({
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    host: true,
    port: 3333
  },
  publicDir: 'public'
});
