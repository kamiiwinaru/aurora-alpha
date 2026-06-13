class RecognizerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buf = []
    this._bufLen = 0
    this._chunkSize = 4096
  }

  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      const samples = input[0]
      for (let i = 0; i < samples.length; i++) {
        this._buf.push(samples[i])
      }
      this._bufLen += samples.length
      if (this._bufLen >= this._chunkSize) {
        const out = new Float32Array(this._buf.splice(0, this._chunkSize))
        this._bufLen -= this._chunkSize
        this.port.postMessage(out)
      }
    }
    return true
  }
}
registerProcessor('recognizer-processor', RecognizerProcessor)
