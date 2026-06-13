// Vosk offline recognition — stubbed out pending Smart App Control investigation.
// useVoiceInput checks isElectron to decide whether to use this path;
// with these stubs it will never reach a ready state and falls back to Web Speech API.

export type VoskStatus = 'idle' | 'loading' | 'ready' | 'error'
export type VoskResult = { text: string; partial: boolean }

export async function loadVoskModel(_onProgress?: (pct: number) => void): Promise<never> {
  throw new Error('Vosk not available in this build')
}

export async function prewarmAudio(): Promise<void> {
  // no-op
}

export class VoskSession {
  static async create(_model: never, _onResult: (r: VoskResult) => void): Promise<VoskSession> {
    throw new Error('Vosk not available in this build')
  }
  stop() {}
}
