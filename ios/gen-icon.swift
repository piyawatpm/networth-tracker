// Generates the app icon: volt "$" with a neon bloom on pure black —
// the OKX-theme mark, drawn not downloaded. Run: swift gen-icon.swift <out>
import AppKit

let size = CGSize(width: 1024, height: 1024)
let volt = NSColor(red: 0.80, green: 0.96, blue: 0.27, alpha: 1)

let image = NSImage(size: size)
image.lockFocus()

NSColor.black.setFill()
NSRect(origin: .zero, size: size).fill()

// Subtle dot-matrix field, echoing the chart fill.
volt.withAlphaComponent(0.10).setFill()
let spacing: CGFloat = 64
var y: CGFloat = 48
while y < size.height - 24 {
    var x: CGFloat = 48
    while x < size.width - 24 {
        NSBezierPath(ovalIn: NSRect(x: x - 5, y: y - 5, width: 10, height: 10)).fill()
        x += spacing
    }
    y += spacing
}

func draw(_ text: String, fontSize: CGFloat, color: NSColor, blur: CGFloat) {
    let base = NSFont.systemFont(ofSize: fontSize, weight: .bold)
    let font: NSFont
    if let rounded = base.fontDescriptor.withDesign(.rounded),
       let roundedFont = NSFont(descriptor: rounded, size: fontSize) {
        font = roundedFont
    } else {
        font = base
    }
    let shadow = NSShadow()
    if blur > 0 {
        shadow.shadowColor = color
        shadow.shadowBlurRadius = blur
        shadow.shadowOffset = .zero
    }
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .shadow: shadow,
    ]
    let string = NSAttributedString(string: text, attributes: attributes)
    let bounds = string.boundingRect(with: size, options: [.usesLineFragmentOrigin])
    string.draw(at: NSPoint(
        x: (size.width - bounds.width) / 2,
        y: (size.height - bounds.height) / 2 - bounds.origin.y
    ))
}

// Bloom pass, then the crisp glyph on top — same trick as the chart line.
draw("$", fontSize: 700, color: volt.withAlphaComponent(0.35), blur: 90)
draw("$", fontSize: 700, color: volt, blur: 0)

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("PNG encode failed")
}
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
try! png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
