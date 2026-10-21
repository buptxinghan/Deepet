import AppKit
import Foundation

// Deterministic bitmap font resource, independent of the animation assets.
let arguments = CommandLine.arguments
guard arguments.count == 4 else { fatalError("BuildFont codepoints.json font.bin licensed-font-name") }
let codes = try JSONDecoder().decode([UInt16].self, from: Data(contentsOf: URL(fileURLWithPath: arguments[1]))).sorted()
let width = 12, height = 14
var output = Data("WCF1".utf8)
func u16(_ value: UInt16) { output.append(UInt8(value & 255)); output.append(UInt8(value >> 8)) }
u16(UInt16(codes.count)); output.append(UInt8(width)); output.append(UInt8(height))
for code in codes { u16(code) }
guard let font = NSFont(name: arguments[3], size: 12) else { fatalError("Requested font is not installed") }
var blank = 0
for code in codes {
    autoreleasepool {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32)!
        let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = graphics
        graphics.shouldAntialias = false
        NSColor.black.setFill(); NSRect(x: 0, y: 0, width: width, height: height).fill()
        let scalar = UnicodeScalar(Int(code))!
        String(scalar).draw(in: NSRect(x: 0, y: -1, width: width + 1, height: height + 1), withAttributes: [.font: font, .foregroundColor: NSColor.white])
        NSGraphicsContext.restoreGraphicsState()
        var ink = false
        for y in 0..<height {
            var row: UInt16 = 0
            for x in 0..<width {
                if let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), color.redComponent > 0.45 { row |= UInt16(1 << (15 - x)); ink = true }
            }
            u16(row)
        }
        if !ink { blank += 1 }
    }
}
try output.write(to: URL(fileURLWithPath: arguments[2]), options: .atomic)
print("Font: \(codes.count) glyphs, \(output.count) bytes, \(blank) blank cells")
