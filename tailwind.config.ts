import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: 'rgb(var(--color-canvas) / <alpha-value>)',
          elevated: 'rgb(var(--color-canvas-elevated) / <alpha-value>)'
        },
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          soft: 'rgb(var(--color-ink-soft) / <alpha-value>)',
          subtle: 'rgb(var(--color-ink-subtle) / <alpha-value>)'
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          soft: 'rgb(var(--color-accent-soft) / <alpha-value>)'
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
