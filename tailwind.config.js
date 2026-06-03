/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  corePlugins: {
    // Disable preflight to preserve the app's existing base reset exactly
    // (parity-first migration). All utilities remain available.
    preflight: false,
  },
  plugins: [],
};
