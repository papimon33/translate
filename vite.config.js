import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// React 앱은 client/ 에서 개발하고 dist/ 로 빌드. express(server.js)가 dist/ 를 서빙한다.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // vite dev 서버에서 API/WS 를 node 서버(3001)로 프록시 (개발용, 선택)
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
