import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'data/hymns-index.json'],
      manifest: {
        name: 'Hymns For Worship',
        short_name: 'Hymnal',
        description: 'Digital Acappella Hymnal with Pitch Cue and SATB Audio Stems',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        start_url: '/web-hymnal/',
        scope: '/web-hymnal/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/data/hymns/') ||
              url.pathname.includes('/audio/midi/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'hymn-data-and-audio',
              expiration: {
                maxEntries: 1000,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/raw\.githubusercontent\.com\/.*soundfont.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'soundfont-instruments',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  base: '/web-hymnal/',
});
