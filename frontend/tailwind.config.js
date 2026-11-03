/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Orbitron Variable"', 'Orbitron', '"Inter Variable"', 'sans-serif'],
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        coral: '#ff7a59',
        emerald2: '#2fe3a1',
        fire: '#ff8a1f',
        gem: '#7a8bff',
      },
    },
  },
  plugins: [],
}
