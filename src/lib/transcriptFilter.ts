// Rejects transcripts that are noise/silence artifacts rather than real speech.
// Shared between the in-window (useVoiceInput) and global (App.tsx) PTT paths.

const NOISE_ONLY_RE = /^[\s.,!?;:()[\]{}"'`~@#$%^&*_+=|\\/<>-]+$/
const NOISE_WORDS = new Set(['um', 'uh', 'hmm', 'hm', 'ah', 'oh', 'er', 'mm'])

// ASR models (ElevenLabs Scribe included) commonly hallucinate bracketed/
// parenthetical sound-event tags — "[typing]", "[background noise]",
// "(laughs)" — on near-silent or very short clips instead of erroring out.
// Strip those before checking for real content so a transcript that's ONLY
// such a tag gets rejected, not typed verbatim.
const TAG_RE = /\[[^\]]*\]|\([^)]*\)/g

export function isNoiseTranscript(text: string): boolean {
  const t = text.trim()
  if (!t || t.length < 2) return true
  if (NOISE_ONLY_RE.test(t)) return true
  if (NOISE_WORDS.has(t.toLowerCase())) return true
  const withoutTags = t.replace(TAG_RE, '').trim()
  if (!withoutTags || !/[a-zA-Z0-9]/.test(withoutTags)) return true
  return false
}
