import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// WXT config — the manifest is generated from here; do not hand-write manifest.json.
// See https://wxt.dev/
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tailor',
    description: 'Describe a change to any site in plain English; it appears on the page.',
    // userScripts: run generated per-site code. Chrome 138+ requires the user to flip
    // the per-extension "Allow User Scripts" toggle on the extension's details page.
    permissions: ['userScripts', 'sidePanel', 'storage', 'scripting', 'tabs', 'activeTab'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Open Tailor',
    },
  },
  // Compile Tailwind v4 via its Vite plugin before WXT's minifier sees the CSS.
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
