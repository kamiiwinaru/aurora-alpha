import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        eve: {
          black:        '#080b10',
          deep:         '#0a0d12',
          panel:        '#0d1117',
          border:       '#1a2332',
          cyan:         '#00d4ff',
          'cyan-dim':   '#007a94',
          orange:       '#ff6b00',
          'orange-dim': '#7a3300',
          gold:         '#c8a84b',
          text:         '#d6e2ee',   // brightened
          muted:        '#b8944a',   // gold
          dim:          '#7a6030',   // dark gold
          red:          '#cc3333',
          green:        '#33cc66',
        },
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', 'monospace'],
        sans: ['Inter', '"Exo 2"', 'sans-serif'],
      },
      animation: {
        'pulse-ring': 'pulseRing 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
        'pulse-ring-fast': 'pulseRing 0.8s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
        'glow-breathe': 'glowBreathe 3s ease-in-out infinite',
        'scanline': 'scanline 8s linear infinite',
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '80%, 100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        glowBreathe: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(0,212,255,0.15), 0 0 40px rgba(0,212,255,0.05)' },
          '50%': { boxShadow: '0 0 40px rgba(0,212,255,0.35), 0 0 80px rgba(0,212,255,0.15)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
      backgroundImage: {
        'star-field': 'radial-gradient(ellipse at center, #0d1117 0%, #080b10 100%)',
        'panel-gradient': 'linear-gradient(135deg, #0d1117 0%, #0a0f1a 100%)',
        'cyan-glow': 'linear-gradient(135deg, rgba(0,212,255,0.1) 0%, transparent 60%)',
      },
    },
  },
  plugins: [],
}

export default config
