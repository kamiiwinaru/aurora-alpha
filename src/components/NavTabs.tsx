import { motion } from 'framer-motion'
import { MessageSquare, Zap, Factory, Package, TrendingUp, Calculator, Skull, Radio, Bell, Map } from 'lucide-react'
import type { ActivePanel } from '../types'

interface NavTabsProps {
  active: ActivePanel
  onChange: (panel: ActivePanel) => void
}

const TABS: { id: ActivePanel; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { id: 'chat',          label: 'COMMS',   icon: <MessageSquare size={12} />, shortcut: 'F1' },
  { id: 'notifications', label: 'NOTIF',   icon: <Bell size={12} />,          shortcut: 'F2' },
  { id: 'skills',        label: 'SKILLS',  icon: <Zap size={12} />,           shortcut: 'F3' },
  { id: 'industry',      label: 'INDUSTRY',icon: <Factory size={12} />,       shortcut: 'F4' },
  { id: 'assets',        label: 'ASSETS',  icon: <Package size={12} />,       shortcut: 'F5' },
  { id: 'market',        label: 'MARKET',  icon: <TrendingUp size={12} />,    shortcut: 'F6' },
  { id: 'janice',        label: 'APPRAISE',icon: <Calculator size={12} />,    shortcut: 'F7' },
  { id: 'zkill',         label: 'ZKILL',   icon: <Skull size={12} />,         shortcut: 'F8' },
  { id: 'intel',         label: 'INTEL',   icon: <Radio size={12} />,         shortcut: 'F9' },
  { id: 'map',           label: 'MAP',     icon: <Map size={12} />,           shortcut: 'F10' },
]

export default function NavTabs({ active, onChange }: NavTabsProps) {
  return (
    <div className="flex border-b border-eve-border bg-eve-panel relative overflow-x-auto">
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-eve-cyan/20 to-transparent" />

      {TABS.map(tab => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`
              relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-mono uppercase tracking-widest whitespace-nowrap
              transition-all duration-150 border-r border-eve-border last:border-r-0 shrink-0
              ${isActive
                ? 'text-eve-cyan bg-eve-cyan/5'
                : 'text-eve-muted hover:text-eve-text hover:bg-eve-border/20'
              }
            `}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="text-[9px] text-eve-dim hidden xl:inline">{tab.shortcut}</span>

            {isActive && (
              <motion.div
                layoutId="nav-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-eve-cyan"
                style={{ boxShadow: '0 0 6px rgba(0,212,255,0.6)' }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
