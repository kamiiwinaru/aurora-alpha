import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync } from 'fs'

const svg = readFileSync('public/aurora-icon.svg')

// Generate PNGs at each size needed for ICO
const sizes = [16, 32, 48, 64, 128, 256]
const pngBuffers = await Promise.all(
  sizes.map(size =>
    sharp(svg)
      .resize(size, size)
      .png()
      .toBuffer()
  )
)

// Write the 256px PNG for Electron's window icon
writeFileSync('public/aurora-icon.png', pngBuffers[pngBuffers.length - 1])
console.log('Written: public/aurora-icon.png')

// Bundle all sizes into a single .ico
const icoBuffer = await pngToIco(pngBuffers)
writeFileSync('public/aurora-icon.ico', icoBuffer)
console.log('Written: public/aurora-icon.ico')
