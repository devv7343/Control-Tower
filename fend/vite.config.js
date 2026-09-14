import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        // Hardcoding port 5173 to match the backend CORS policy exactly[cite: 2]
        port: 5173,
        strictPort: true,
    }
});