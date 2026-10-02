import struct, zlib, os

BG = (246, 227, 232)
RING = (133, 160, 128)
DOT = (224, 160, 180)
RING_IN, RING_OUT, DOT_R = 0.32, 0.52, 0.17


def pixel(nx, ny, s):
    r = (nx * nx + ny * ny) ** 0.5 / s
    if r <= DOT_R:
        return DOT
    if RING_IN <= r <= RING_OUT:
        return RING
    return BG


def make_png(size, path, s=1.0):
    rows = []
    half = size / 2.0
    for y in range(size):
        row = bytearray(b'\x00')
        for x in range(size):
            # сглаживание: усредняем 4 подпикселя
            acc = [0, 0, 0]
            for dx in (0.25, 0.75):
                for dy in (0.25, 0.75):
                    nx = (x + dx - half) / half
                    ny = (y + dy - half) / half
                    c = pixel(nx, ny, s)
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            row += bytes(a // 4 for a in acc)
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print(path, size, 'ok')


os.makedirs('icons', exist_ok=True)
make_png(192, 'icons/icon-192.png')
make_png(512, 'icons/icon-512.png')
make_png(512, 'icons/icon-maskable-512.png', s=0.78)
make_png(180, 'icons/apple-touch-icon.png')
