import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Farm Data Hub',
    short_name: 'Farm Data Hub',
    description: 'Connect and manage your farm data from John Deere Operations Center',
    start_url: '/map',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#10b981',
    icons: [
      { src: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
