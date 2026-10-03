# Иконки дневника: нежно-розовый фон, «мой дневник» курсивом цвета хаки.
from PIL import Image, ImageDraw, ImageFont

BG = (246, 227, 232)   # нежно-розовый, как в приложении
INK = (117, 144, 111)  # хаки/шалфейный из палитры дневника
FONT = 'MarckScript.ttf'


def fit_font(d, text, target_w, start=100):
    f = ImageFont.truetype(FONT, start)
    b = d.textbbox((0, 0), text, font=f)
    w = max(1, b[2] - b[0])
    return ImageFont.truetype(FONT, max(10, int(start * target_w / w))), b


def draw_icon(size, pad_ratio=0.16, rounded=False):
    img = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(img)
    box = size - int(size * pad_ratio) * 2

    f2, b2 = fit_font(d, 'дневник', box)
    f1, b1 = fit_font(d, 'мой', int(box * 0.52))

    h1, h2 = b1[3] - b1[1], b2[3] - b2[1]
    gap = int(size * 0.045)
    total = h1 + gap + h2
    y1 = (size - total) // 2 + h1 // 2 - b1[1]
    y2 = (size - total) // 2 + h1 + gap + h2 // 2 - b2[1]

    d.text((size // 2, y1), 'мой', font=f1, fill=INK, anchor='mm')
    d.text((size // 2, y2), 'дневник', font=f2, fill=INK, anchor='mm')

    if rounded:
        r = int(size * 0.22)
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], r, fill=255)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    return img


if __name__ == '__main__':
    draw_icon(512, 0.16).save('icons/icon-512.png')
    draw_icon(192, 0.16).save('icons/icon-192.png')
    draw_icon(512, 0.26).save('icons/icon-maskable-512.png')  # безопасная зона для маскируемых
    draw_icon(180, 0.14).save('icons/apple-touch-icon.png')
    draw_icon(320, 0.16).convert('RGB').save('icons/preview.png')  # только для просмотра
    print('иконки перегенерированы')
