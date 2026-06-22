import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ExternalLink, RefreshCw, Skull, Shield, Users } from 'lucide-react'
import { formatISK } from '../lib/eve-esi'

interface CharacterProfile {
  id: number
  name: string
  securityStatus: number
  birthday: string
  corporation: { id: number; name: string; ticker: string; memberCount: number; ceoId: number } | null
  alliance: { id: number; name: string; ticker: string } | null
  zkill: { kills: number; losses: number; iskDestroyed: number; iskLost: number }
}

interface Props {
  name: string | null
  onClose: () => void
  onViewKillboard?: (name: string) => void
  onProfileFetched?: (profile: CharacterProfile) => void
}

function secColor(sec: number) {
  if (sec >= 0.5) return 'text-eve-green'
  if (sec >= 0.1) return 'text-eve-orange'
  return 'text-eve-red'
}

export default function CharacterProfileWindow({ name, onClose, onViewKillboard, onProfileFetched }: Props) {
  const [profile, setProfile] = useState<CharacterProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!name) return
    setProfile(null)
    setError(null)
    setLoading(true)
    fetch(`/api/character/profile?name=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then((d: CharacterProfile & { error?: string }) => {
        if (d.error) setError(d.error)
        else { setProfile(d); onProfileFetched?.(d) }
      })
      .catch(() => setError('Lookup failed'))
      .finally(() => setLoading(false))
  }, [name])

  if (!name) return null

  const efficiency = profile
    ? profile.zkill.kills + profile.zkill.losses > 0
      ? Math.round((profile.zkill.kills / (profile.zkill.kills + profile.zkill.losses)) * 100)
      : null
    : null

  return (
    <AnimatePresence>
      <motion.div
        key="char-profile"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <div
          className="relative eve-panel border border-eve-border bg-eve-black w-[400px] shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Corner brackets */}
          <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-eve-cyan/60" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-eve-cyan/60" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-eve-cyan/60" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-eve-cyan/60" />

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-eve-border/50">
            <div className="text-[10px] tracking-widest text-eve-cyan font-mono uppercase">Pilot Profile</div>
            <button onClick={onClose} className="text-eve-muted hover:text-eve-text transition-colors">
              <X size={12} />
            </button>
          </div>

          {/* Body */}
          <div className="p-4">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-eve-muted text-[11px]">
                <RefreshCw size={12} className="animate-spin" />
                Resolving pilot data...
              </div>
            )}

            {error && (
              <div className="text-eve-red text-[11px] py-4 text-center">{error}</div>
            )}

            {profile && (
              <div className="flex flex-col gap-3">
                {/* Portrait + identity */}
                <div className="flex gap-3 items-start">
                  <div className="relative shrink-0">
                    <img
                      src={`https://images.evetech.net/characters/${profile.id}/portrait?size=128`}
                      alt={profile.name}
                      width={80}
                      height={80}
                      className="object-cover bg-eve-border"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                    <div className="absolute bottom-0 right-0 bg-eve-black/80 px-1 py-0.5">
                      <span className={`text-[9px] font-mono font-bold ${secColor(profile.securityStatus)}`}>
                        {profile.securityStatus.toFixed(1)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="text-eve-text text-sm font-mono font-bold truncate">{profile.name}</div>
                    <div className="text-[9px] text-eve-dim">
                      Born {new Date(profile.birthday).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })}
                    </div>

                    {profile.corporation && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <img
                          src={`https://images.evetech.net/corporations/${profile.corporation.id}/logo?size=32`}
                          alt=""
                          width={16}
                          height={16}
                          className="object-cover bg-eve-border"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <div>
                          <div className="text-[10px] text-eve-text truncate">
                            {profile.corporation.name}
                            <span className="text-eve-muted ml-1">[{profile.corporation.ticker}]</span>
                          </div>
                          <div className="flex items-center gap-1 text-[9px] text-eve-dim">
                            <Users size={8} />
                            {profile.corporation.memberCount.toLocaleString()} members
                          </div>
                        </div>
                      </div>
                    )}

                    {profile.alliance && (
                      <div className="flex items-center gap-1.5">
                        <img
                          src={`https://images.evetech.net/alliances/${profile.alliance.id}/logo?size=32`}
                          alt=""
                          width={16}
                          height={16}
                          className="object-cover bg-eve-border"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <div className="text-[10px] text-eve-muted truncate">
                          {profile.alliance.name}
                          <span className="text-eve-dim ml-1">[{profile.alliance.ticker}]</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* zkill stats */}
                <div className="border-t border-eve-border/40 pt-3">
                  <div className="text-[9px] text-eve-dim tracking-widest uppercase mb-2">Recent Activity (last 25)</div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="eve-panel p-2 text-center">
                      <div className="text-eve-green text-sm font-mono">{profile.zkill.kills}</div>
                      <div className="text-[9px] text-eve-muted">KILLS</div>
                    </div>
                    <div className="eve-panel p-2 text-center">
                      <div className="text-eve-red text-sm font-mono">{profile.zkill.losses}</div>
                      <div className="text-[9px] text-eve-muted">LOSSES</div>
                    </div>
                    <div className="eve-panel p-2 text-center">
                      <div className={`text-sm font-mono ${efficiency !== null && efficiency >= 60 ? 'text-eve-green' : efficiency !== null && efficiency >= 40 ? 'text-eve-gold' : 'text-eve-red'}`}>
                        {efficiency !== null ? `${efficiency}%` : '—'}
                      </div>
                      <div className="text-[9px] text-eve-muted">EFF</div>
                    </div>
                    <div className="eve-panel p-2 text-center">
                      <div className="text-eve-gold text-[11px] font-mono">{formatISK(profile.zkill.iskDestroyed)}</div>
                      <div className="text-[9px] text-eve-muted">DESTR.</div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {onViewKillboard && (
                    <button
                      onClick={() => { onViewKillboard(profile.name); onClose() }}
                      className="eve-btn-primary flex items-center gap-1.5 text-[10px] flex-1 justify-center py-1.5"
                    >
                      <Skull size={10} />FULL KILLBOARD
                    </button>
                  )}
                  <button
                    onClick={() => window.open(`https://zkillboard.com/character/${profile.id}/`, '_blank')}
                    className="eve-btn flex items-center gap-1.5 text-[10px] px-3"
                  >
                    <ExternalLink size={10} />ZKILL
                  </button>
                  <button
                    onClick={() => window.open(`https://evewho.com/character/${profile.id}`, '_blank')}
                    className="eve-btn flex items-center gap-1.5 text-[10px] px-3"
                  >
                    <Shield size={10} />EVEWHO
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
