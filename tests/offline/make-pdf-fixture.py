# 自制中文 PDF 夹具：多页、横竖混排、嵌入中文字体子集。
# 内容为本次验收自撰文本，不含任何完整书稿或第三方受版权保护的正文，可随仓库分发。
# 用法: python tests/offline/make-pdf-fixture.py <output.pdf>
import sys
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = sys.argv[1]
FONT_PATH = 'C:/Windows/Fonts/simhei.ttf'
pdfmetrics.registerFont(TTFont('FixtureHei', FONT_PATH))

TITLE = '山窗书屋离线验收 · 自制中文书稿'
PAGES = [
    ('portrait', '第一章 · 竖排页面', [
        '这是一份为离线验收自制的测试书稿，只包含本次验收撰写的说明文字。',
        '竖排页面用于检查单页视图下的行距、字距与页边距是否正确。',
        '测试重点：中文字形是否完整、标点是否占位、段落是否自动换行。',
        '书中出现英文与数字时（PDF 6.5.438、15 MB、2026 年），应保持同一行高。',
        '如果字体子集缺失，下面的常用字会显示为空框：窗、橘、炉、脊、檐、暮、砚。',
    ]),
    ('landscape', '第二章 · 横排页面', [
        '横排页面宽度更大，用于检查双页视图与缩放后的可读性。',
        '横排时正文仍应完整落在版面内，不出现裁切或右侧溢出。',
        '这一页同时验证：导入后立即翻页时不会出现空白页占位。',
    ]),
    ('portrait', '第三章 · 标点与符号', [
        '标点符号检查：，。、；：“”‘’《》（）——……％·',
        '数字与单位：0 1 2 3 4 5 6 7 8 9 ％ ℃ MB GB',
        '生僻字与繁体：書屋 窗 讀 頁 鐘 籤 疊 醬',
        '英文混排：The mountain window study room is quiet and offline.',
    ]),
    ('landscape', '第四章 · 缩放到 200%', [
        '这一页用于放大验证：在 200% 缩放下，本行文字应清晰可读而不模糊。',
        '放大后拖动平移，边缘不应出现书页外的空白或背景穿透。',
        '缩小回适应页面后，整页应重新完整可见。',
    ]),
    ('portrait', '第五章 · 翻页连续性', [
        '连续翻页验证：从第 1 页到第 6 页再返回，页码指示应同步。',
        '翻页过程中不应触发网络请求，也不应出现加载遮罩残留。',
        '本页为第 5 页，下一页为最后一页。',
    ]),
    ('landscape', '第六章 · 末页', [
        '最后一页用于确认总页数为 6 页，且末页之后不会出现空白越界页。',
        '到此为止，全部内容均为本次验收自制的测试文字。',
        '（夹具结束）',
    ]),
]

c = canvas.Canvas(OUT, pagesize=A4)
c.setTitle('山窗书屋离线验收自制中文书稿')
c.setAuthor('offline-acceptance (round2)')
c.setSubject('round2 offline acceptance fixture: multi-page, portrait+landscape, CJK subset')
for index, (orient, heading, lines) in enumerate(PAGES, start=1):
    size = landscape(A4) if orient == 'landscape' else A4
    c.setPageSize(size)
    width, height = size
    c.setFont('FixtureHei', 9)
    c.drawString(20 * mm, height - 15 * mm, TITLE)
    c.drawRightString(width - 20 * mm, height - 15 * mm, '第 %d 页 / 共 6 页' % index)
    c.setLineWidth(0.6)
    c.line(20 * mm, height - 18 * mm, width - 20 * mm, height - 18 * mm)
    c.setFont('FixtureHei', 18)
    c.drawString(20 * mm, height - 30 * mm, heading)
    c.setFont('FixtureHei', 12)
    y = height - 45 * mm
    for line in lines:
        c.drawString(20 * mm, y, line)
        y -= 9 * mm
    c.setFont('FixtureHei', 10)
    c.drawString(20 * mm, 20 * mm, '方向：%s · 页面尺寸：%.0f×%.0f pt' % (orient, width, height))
    c.showPage()
c.save()
print('wrote', OUT)
