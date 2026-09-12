import os
import base64
from PIL import Image

def build_favicons():
    src_path = r'C:\Users\nkris\.gemini\antigravity-ide\brain\ab291b0a-aa3a-43f6-af68-071f51dcf368\.user_uploaded\media_1789199275898.jpg'
    extracted_path = 'assets/images/favicon/test_extracted.png'
    
    if os.path.exists(extracted_path):
        img = Image.open(extracted_path)
    else:
        img = Image.open(src_path).convert('RGBA')

    favicon_dir = 'assets/images/favicon'
    os.makedirs(favicon_dir, exist_ok=True)
    os.makedirs('assets/images/logo', exist_ok=True)

    sizes = {
        'favicon-16x16.png': (16, 16),
        'favicon-32x32.png': (32, 32),
        'favicon-48x48.png': (48, 48),
        'favicon-96x96.png': (96, 96),
        'apple-touch-icon.png': (180, 180),
        'apple-icon.png': (180, 180),
        'apple-icon-180x180.png': (180, 180),
        'apple-icon-152x152.png': (152, 152),
        'apple-icon-144x144.png': (144, 144),
        'apple-icon-120x120.png': (120, 120),
        'apple-icon-114x114.png': (114, 114),
        'apple-icon-76x76.png': (76, 76),
        'apple-icon-72x72.png': (72, 72),
        'apple-icon-60x60.png': (60, 60),
        'apple-icon-57x57.png': (57, 57),
        'android-icon-192x192.png': (192, 192),
        'android-icon-144x144.png': (144, 144),
        'android-icon-96x96.png': (96, 96),
        'android-icon-72x72.png': (72, 72),
        'android-icon-48x48.png': (48, 48),
        'android-icon-36x36.png': (36, 36),
        'ms-icon-144x144.png': (144, 144),
        'ms-icon-150x150.png': (150, 150),
        'ms-icon-310x310.png': (310, 310),
        'ms-icon-70x70.png': (70, 70),
        'favicon-512x512.png': (512, 512),
    }

    for filename, dim in sizes.items():
        resized = img.resize(dim, Image.Resampling.LANCZOS)
        resized.save(os.path.join(favicon_dir, filename), 'PNG')

    # Multi-resolution ICO
    img.save('assets/images/favicon/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    img.save('favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    img.save('assets/images/logo/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])

    # Embed in SVG for razor-sharp SVG favicon support
    with open('assets/images/favicon/favicon-512x512.png', 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('utf-8')

    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <image width="512" height="512" href="data:image/png;base64,{b64}"/>
</svg>'''

    with open('assets/images/favicon/favicon.svg', 'w') as f:
        f.write(svg_content)
    with open('favicon.svg', 'w') as f:
        f.write(svg_content)

    # Clean up test files
    if os.path.exists(extracted_path):
        os.remove(extracted_path)

    print("Favicons generated successfully from user image!")

if __name__ == '__main__':
    build_favicons()
