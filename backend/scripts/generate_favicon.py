import os
from PIL import Image, ImageDraw

def generate_all_favicons():
    favicon_dir = 'assets/images/favicon'
    os.makedirs(favicon_dir, exist_ok=True)
    os.makedirs('assets/images/logo', exist_ok=True)

    # 1. Master High-Resolution Canvas (512x512)
    size = 512
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background Squircle: Deep slate navy (#0b1120) with solar amber/gold rim (#f59e0b)
    margin = 16
    radius = 112
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill=(11, 17, 32, 255),
        outline=(245, 158, 11, 245),
        width=13
    )

    # Inner subtle cyan glow
    draw.rounded_rectangle(
        [margin + 8, margin + 8, size - margin - 8, size - margin - 8],
        radius=radius - 8,
        fill=None,
        outline=(56, 189, 248, 45),
        width=3
    )

    # Drill - Battery Base
    draw.rounded_rectangle([104, 400, 248, 452], radius=16, fill=(51, 65, 85, 255), outline=(71, 85, 105, 255), width=4)
    # Battery power LED bar (green)
    draw.rounded_rectangle([144, 428, 208, 440], radius=5, fill=(34, 197, 94, 255))

    # Drill - Handle
    handle = [(136, 304), (216, 304), (208, 402), (136, 402)]
    draw.polygon(handle, fill=(255, 255, 255, 255))
    # Rubber grip pad
    draw.polygon([(144, 320), (176, 320), (172, 392), (144, 392)], fill=(30, 41, 59, 255))

    # Drill - Red Trigger
    draw.polygon([(216, 320), (240, 340), (216, 360)], fill=(239, 68, 68, 255))

    # Drill - Main Motor Body
    draw.rounded_rectangle([72, 200, 272, 312], radius=36, fill=(255, 255, 255, 255))
    # Electric Cyan Accent Stripe
    draw.rounded_rectangle([92, 236, 252, 276], radius=12, fill=(2, 132, 199, 255))

    # Drill - Chuck Collar (Silver)
    draw.rounded_rectangle([268, 216, 316, 296], radius=12, fill=(203, 213, 225, 255))
    draw.line([(292, 222), (292, 290)], fill=(100, 116, 139, 255), width=5)

    # Drill - Keyless Chuck (Dark Slate)
    draw.rounded_rectangle([316, 224, 364, 288], radius=10, fill=(51, 65, 85, 255))
    draw.line([(340, 228), (340, 284)], fill=(100, 116, 139, 255), width=4)

    # Drill - Bit (Solid Steel)
    draw.polygon([(364, 244), (410, 250), (424, 256), (410, 262), (364, 268)], fill=(226, 232, 240, 255))

    # Lightning Bolt (Electric Power Icon) - High Energy Golden Amber
    bolt = [
        (376, 48),   # Top sharp tip
        (296, 184),  # Inner left
        (360, 184),  # Middle shelf right
        (280, 304),  # Bottom sharp tip
        (432, 152),  # Outer right
        (368, 152)   # Outer shelf left
    ]
    draw.polygon(bolt, fill=(245, 158, 11, 255), outline=(180, 83, 9, 255))

    # Lightning Bolt Inner Highlight
    bolt_inner = [
        (376, 72),
        (312, 178),
        (360, 178),
        (304, 276),
        (412, 162),
        (364, 162)
    ]
    draw.polygon(bolt_inner, fill=(254, 240, 138, 255))

    # Save 512x512
    img.save(os.path.join(favicon_dir, 'favicon-512x512.png'), 'PNG')

    # Generate PNG sizes
    sizes = {
        'favicon-16x16.png': (16, 16),
        'favicon-32x32.png': (32, 32),
        'favicon-48x48.png': (48, 48),
        'apple-touch-icon.png': (180, 180),
        'apple-icon.png': (180, 180),
        'apple-icon-180x180.png': (180, 180),
        'android-icon-192x192.png': (192, 192)
    }

    for filename, dim in sizes.items():
        resized = img.resize(dim, Image.Resampling.LANCZOS)
        resized.save(os.path.join(favicon_dir, filename), 'PNG')

    # Generate Multi-Resolution favicon.ico (16, 32, 48)
    ico_path = os.path.join(favicon_dir, 'favicon.ico')
    img.save(ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    
    # Also save to root and logo dir to guarantee zero broken links
    img.save('favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    img.save('assets/images/logo/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])

    # 2. Generate Native Vector SVG Favicon
    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1120"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="45%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
    <linearGradient id="azureGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    <linearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>

  <!-- 1. High-Contrast Squircle Tile (Ensures 100% visibility in both dark and light browser tabs) -->
  <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#bgGrad)"/>
  <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="13.25" fill="none" stroke="url(#rimGrad)" stroke-width="1.8" opacity="0.95"/>

  <!-- 2. Electric Cordless Power Drill -->
  <g id="drill-group">
    <!-- Battery Base -->
    <rect x="13" y="50" width="18" height="6.5" rx="2" fill="#334155" stroke="#475569" stroke-width="0.6"/>
    <rect x="18" y="53.5" width="8" height="1.5" rx="0.75" fill="#22c55e"/>

    <!-- Ergonomic Handle -->
    <path d="M17 38 L27 38 L26 50 L17 50 Z" fill="#ffffff"/>
    <path d="M18 40 L22 40 L21.5 49 L18 49 Z" fill="#1e293b"/>

    <!-- Red Trigger -->
    <polygon points="27,40 30,42.5 27,45" fill="#ef4444"/>

    <!-- Main Drill Body -->
    <rect x="9" y="25" width="25" height="14" rx="4.5" fill="#ffffff"/>
    <!-- Electric Cyan Stripe -->
    <rect x="11.5" y="29.5" width="20" height="5" rx="1.5" fill="url(#azureGrad)"/>

    <!-- Chuck Collar / Gearbox -->
    <path d="M33.5 27 H39.5 Q40.5 27 40.5 28.5 V35.5 Q40.5 37 39.5 37 H33.5 Z" fill="#cbd5e1"/>

    <!-- Keyless Chuck -->
    <rect x="40.5" y="28" width="6" height="8" rx="1.5" fill="#334155"/>
    <line x1="43.5" y1="28" x2="43.5" y2="36" stroke="#64748b" stroke-width="0.8"/>

    <!-- Drill Bit -->
    <polygon points="46.5,30.5 51.5,31.5 53,32 51.5,32.5 46.5,33.5" fill="#e2e8f0"/>
  </g>

  <!-- 3. Dynamic Lightning Bolt (Electric Power) -->
  <polygon points="47,6 37,23 45,23 35,38 54,19 46,19" 
           fill="url(#boltGrad)" 
           stroke="#b45309" 
           stroke-width="0.8" 
           stroke-linejoin="miter"/>
</svg>'''

    with open(os.path.join(favicon_dir, 'favicon.svg'), 'w') as f:
        f.write(svg_content)
    with open('favicon.svg', 'w') as f:
        f.write(svg_content)

    print('Successfully generated all Electric Drill + Lightning favicon assets!')

if __name__ == '__main__':
    generate_all_favicons()
