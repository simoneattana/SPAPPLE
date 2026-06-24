/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        spapple: {
          black: '#050608',
          panel: '#090b10',
          positive: '#deff9a',
          negative: '#ef8f8f',
        },
      },
    },
  },
  plugins: [],
}
