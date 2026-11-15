import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// 학생 사이트(index.html)와 관리 사이트(admin.html) 두 쪽을 같이 굽는다.
// 결과는 dist/ 에 나오고, 서버(council.py)가 그 파일을 그대로 보낸다.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {input: {index: 'index.html', admin: 'admin.html'}},
  },
  server: {proxy: {'/api': 'http://127.0.0.1:8792', '/img': 'http://127.0.0.1:8792'}},
});
