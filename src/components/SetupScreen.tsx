import { useEffect, useState } from 'react'

interface Field {
  key: string
  label: string
  placeholder: string
  required: boolean
  hint: string
  type?: 'password' | 'text'
}

const FIELDS: Field[] = [
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API Key',
    placeholder: 'sk-ant-api03-...',
    required: true,
    hint: 'console.anthropic.com → API Keys',
    type: 'password',
  },
  {
    key: 'EVE_CLIENT_ID',
    label: 'EVE Client ID',
    placeholder: 'abc123...',
    required: true,
    hint: 'developers.eveonline.com → Your Application',
  },
  {
    key: 'EVE_CLIENT_SECRET',
    label: 'EVE Client Secret',
    placeholder: 'eat_...',
    required: true,
    hint: 'developers.eveonline.com → Your Application',
    type: 'password',
  },
  {
    key: 'ELEVENLABS_API_KEY',
    label: 'ElevenLabs API Key',
    placeholder: 'sk_...',
    required: false,
    hint: 'Optional — enables voice synthesis',
    type: 'password',
  },
  {
    key: 'ELEVENLABS_VOICE_ID',
    label: 'ElevenLabs Voice ID',
    placeholder: 'ZF6FPAbjXT4488VcRRnw',
    required: false,
    hint: 'Optional — voice ID from ElevenLabs',
  },
]

interface Props {
  missingKeys: string[]
  onComplete: () => void
}

export default function SetupScreen({ missingKeys, onComplete }: Props) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    window.electronAPI?.getEnvValues().then(existing => {
      setValues(existing)
    })
  }, [])

  const requiredFields = FIELDS.filter(f => f.required)
  const optionalFields = FIELDS.filter(f => !f.required)
  const stillMissing = requiredFields.filter(f => !values[f.key]?.trim())

  async function handleSave() {
    if (stillMissing.length > 0) {
      setError(`Required: ${stillMissing.map(f => f.label).join(', ')}`)
      return
    }
    setSaving(true)
    setError('')
    const remaining = await window.electronAPI!.saveEnvValues(values)
    setSaving(false)
    if (remaining.length === 0) {
      onComplete()
    } else {
      setError(`Still missing: ${remaining.join(', ')}`)
    }
  }

  function renderField(field: Field) {
    const isRevealed = revealed[field.key]
    return (
      <div key={field.key} className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] tracking-widest text-eve-cyan/80 uppercase">
            {field.label}
            {field.required && <span className="text-eve-red ml-1">*</span>}
          </label>
          <span className="text-[10px] text-eve-dim">{field.hint}</span>
        </div>
        <div className="relative">
          <input
            className="eve-input w-full pr-8 text-sm"
            type={field.type === 'password' && !isRevealed ? 'password' : 'text'}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
            autoComplete="off"
          />
          {field.type === 'password' && (
            <button
              type="button"
              onClick={() => setRevealed(r => ({ ...r, [field.key]: !r[field.key] }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-eve-dim hover:text-eve-cyan transition-colors text-[10px]"
            >
              {isRevealed ? 'HIDE' : 'SHOW'}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-eve-black flex items-center justify-center p-6">
      {/* Corner brackets */}
      <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-eve-cyan/60" />
      <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-eve-cyan/60" />
      <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-eve-cyan/60" />
      <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-eve-cyan/60" />

      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="text-eve-cyan text-glow-cyan text-xl tracking-[0.4em] font-mono uppercase">
            ◈ AURORA
          </div>
          <div className="text-eve-muted text-xs tracking-widest uppercase">
            Initial Configuration
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-eve-cyan/30 to-transparent mt-3" />
        </div>

        {/* Required fields */}
        <div className="eve-panel p-4 space-y-4">
          <div className="text-[10px] tracking-widest text-eve-muted uppercase mb-2">Required</div>
          {requiredFields.map(renderField)}
        </div>

        {/* Optional fields */}
        <div className="eve-panel p-4 space-y-4">
          <div className="text-[10px] tracking-widest text-eve-muted uppercase mb-2">Optional</div>
          {optionalFields.map(renderField)}
        </div>

        {error && (
          <div className="text-eve-red text-xs text-center tracking-wide">{error}</div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || stillMissing.length > 0}
          className="eve-btn-primary w-full py-2.5 text-sm tracking-widest uppercase disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'SAVING...' : 'INITIALIZE AURORA'}
        </button>

        {missingKeys.length === 0 && (
          <button
            onClick={onComplete}
            className="w-full text-center text-eve-dim text-xs hover:text-eve-muted transition-colors"
          >
            Skip — use existing configuration
          </button>
        )}
      </div>
    </div>
  )
}
