# Halve the Sirocco board's two big textures each way (2048x8192 -> 1024x4096) for the game version.
# Usage: python3 tools/board/resize-textures.py art/board/Sirocco_Dune156.glb  (writes deck_1k4k.jpg and base_1k4k.png here)
import io, json, struct, sys
from PIL import Image

data = open(sys.argv[1], 'rb').read()
json_len = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20 + json_len])
bin_start = 20 + json_len + 8
def image(name):
    im = next(i for i in gltf['images'] if i['name'] == name)
    view = gltf['bufferViews'][im['bufferView']]
    start = bin_start + view.get('byteOffset', 0)
    return Image.open(io.BytesIO(data[start:start + view['byteLength']]))
image('Deck_2Kx8K').resize((1024, 4096), Image.LANCZOS).save('deck_1k4k.jpg', quality=93, subsampling=0)
image('Base_2Kx8K').resize((1024, 4096), Image.LANCZOS).save('base_1k4k.png', optimize=True)
