import { createModel, KaldiRecognizer, Model } from 'vosk-browser'

// Served via Express proxy to avoid CORS + cross-origin header issues
const MODEL_URL = 'http://localhost:3001/api/vosk-model'

export type VoskStatus = 'idle' | 'loading' | 'ready' | 'error'

export type VoskResult = {
  text: string
  partial: boolean
}

let model: Model | null = null
let loadPromise: Promise<Model> | null = null

// Pre-warmed audio infrastructure — reused across sessions to avoid cold-start delay
let warmStream: MediaStream | null = null
let warmWorkletCtx: AudioContext | null = null
let warmWorkletReady = false

export async function loadVoskModel(
  onProgress?: (pct: number) => void
): Promise<Model> {
  if (model) return model
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const response = await fetch(MODEL_URL)
    if (!response.ok) throw new Error(`Failed to fetch model: ${response.status}`)

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    let received = 0
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      if (contentLength && onProgress) {
        onProgress(Math.round((received / contentLength) * 100))
      }
    }

    const blob = new Blob(chunks as BlobPart[])
    const blobUrl = URL.createObjectURL(blob)

    try {
      model = await createModel(blobUrl)
    } finally {
      URL.revokeObjectURL(blobUrl)
    }

    return model!
  })()

  return loadPromise
}

// Call once after the model is ready. Requests mic permission and pre-loads the
// AudioWorklet module so the first VoskSession.create() call is near-instant.
export async function prewarmAudio(): Promise<void> {
  try {
    if (!warmStream) {
      warmStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    }
    if (!warmWorkletReady) {
      warmWorkletCtx = new AudioContext({ sampleRate: 16000 })
      await warmWorkletCtx.audioWorklet.addModule('/recognizer-processor.js')
      warmWorkletCtx.suspend()
      warmWorkletReady = true
    }
  } catch {
    // Non-fatal — session create will fall back to cold path
  }
}

export class VoskSession {
  private recognizer: KaldiRecognizer
  private audioCtx: AudioContext
  private source: MediaStreamAudioSourceNode
  private workletNode: AudioWorkletNode
  private stream: MediaStream

  private constructor(
    recognizer: KaldiRecognizer,
    audioCtx: AudioContext,
    source: MediaStreamAudioSourceNode,
    workletNode: AudioWorkletNode,
    stream: MediaStream
  ) {
    this.recognizer = recognizer
    this.audioCtx = audioCtx
    this.source = source
    this.workletNode = workletNode
    this.stream = stream
  }

  static async create(
    model: Model,
    onResult: (r: VoskResult) => void
  ): Promise<VoskSession> {
    // Reuse pre-warmed stream if available, otherwise fall back to cold request
    const stream = warmStream ?? await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    warmStream = null  // consumed — next prewarm will refresh it

    // Fresh AudioContext per session, but worklet module is cached by the browser
    // after the first load so addModule() resolves from cache
    const audioCtx = new AudioContext({ sampleRate: 16000 })
    await audioCtx.audioWorklet.addModule('/recognizer-processor.js')

    const recognizer = new model.KaldiRecognizer(16000) as KaldiRecognizer

    recognizer.on('result', (msg: any) => {
      const text: string = msg?.result?.text ?? ''
      if (text) onResult({ text, partial: false })
    })

    recognizer.on('partialresult', (msg: any) => {
      const text: string = msg?.result?.partial ?? ''
      if (text) onResult({ text, partial: true })
    })

    const source = audioCtx.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(audioCtx, 'recognizer-processor', {
      channelCount: 1,
      numberOfInputs: 1,
      numberOfOutputs: 1,
    })

    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const samples = new Float32Array(e.data.buffer.slice(0))
      const buf = audioCtx.createBuffer(1, samples.length, 16000)
      buf.copyToChannel(samples, 0)
      recognizer.acceptWaveform(buf)
    }

    source.connect(workletNode)

    // Replenish the warm stream in the background for next use
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(s => { warmStream = s })
      .catch(() => {})

    return new VoskSession(recognizer, audioCtx, source, workletNode, stream)
  }

  stop() {
    try { this.source.disconnect() } catch { /* ignore */ }
    try { this.workletNode.disconnect() } catch { /* ignore */ }
    try { this.audioCtx.close() } catch { /* ignore */ }
    this.stream.getTracks().forEach(t => t.stop())
    this.recognizer.remove()
  }
}
