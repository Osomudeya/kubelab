/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Status colors
        'status-running': '#10b981',
        'status-pending': '#f59e0b',
        'status-failed': '#ef4444',
        'status-unknown': '#6b7280',
      },
    },
  },
  plugins: [],
}

