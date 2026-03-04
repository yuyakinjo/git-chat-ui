import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: '#f3f4f8',
          elevated: '#ffffff'
        },
        ink: {
          DEFAULT: '#1d1d1f',
          soft: '#3c3c43',
          subtle: '#6e6e73'
        },
        accent: {
          DEFAULT: '#0071e3',
          soft: '#e8f2ff'
        }
      },
      boxShadow: {
        panel: '0 20px 48px rgba(15, 23, 42, 0.12)',
        inset: 'inset 0 1px 0 rgba(255, 255, 255, 0.7)'
      },
      borderRadius: {
        panel: '20px'
      }
    }
  },
  plugins: []
};

export default config;
