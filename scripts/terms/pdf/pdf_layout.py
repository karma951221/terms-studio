"""알파Plus 약관 PDF 페이지 → 읽기 순서 요소 스트림 (PyMuPDF).

요소(dict):
  kind = 'line'  : text(원문, 끝 공백 유지), size, x0,y0,x1,y1, col, box(상자 id 또는 None)
  kind = 'table' : rows(list[list[str]]), x0,y0,x1,y1, col
처리:
  - 2단 컬럼(좌단 전체 → 우단 전체). 두 단에 걸친 요소는 띠(band) 경계로 처리
  - 쪽번호(Helvetica-Bold 하단 숫자) 제거
  - find_tables() 표 → 셀 텍스트. 안쪽 가로줄 없는 표(여러 행이 한 칸에 뭉친 표)는 짧은 값 열(코드·지급률)의 줄 위치로 행 재분할
  - 네 변 선으로 그린 상자(용어 설명·법령 인용) → 상자 안 줄에 box id 부여
"""
import re

PAGE_NUM_FONT = 'Helvetica-Bold'
ARROWS = re.compile(r'^[\s↓↑→←…·∙\-−]+$')


def _hv_lines(page):
    hs, vs = [], []
    for g in page.get_drawings():
        for it in g['items']:
            if it[0] == 'l':
                p1, p2 = it[1], it[2]
                if abs(p1.y - p2.y) < 0.8 and abs(p1.x - p2.x) > 8:
                    hs.append((min(p1.x, p2.x), max(p1.x, p2.x), (p1.y + p2.y) / 2))
                elif abs(p1.x - p2.x) < 0.8 and abs(p1.y - p2.y) > 8:
                    vs.append(((p1.x + p2.x) / 2, min(p1.y, p2.y), max(p1.y, p2.y)))
            elif it[0] == 're':
                r = it[1]
                if r.height < 1.2 and r.width > 8:
                    hs.append((r.x0, r.x1, (r.y0 + r.y1) / 2))
                elif r.width < 1.2 and r.height > 8:
                    vs.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
    # 중복 제거
    hs = sorted(set((round(a, 0), round(b, 0), round(c, 0)) for a, b, c in hs), key=lambda t: (t[2], t[0]))
    vs = sorted(set((round(a, 0), round(b, 0), round(c, 0)) for a, b, c in vs))
    return hs, vs


def find_boxes(page, table_rects):
    """테두리만 있는 상자(내부 선 없음) 사각형 목록."""
    hs, vs = _hv_lines(page)
    boxes = []
    tol = 2.5
    for i, (ax0, ax1, ay) in enumerate(hs):
        for (bx0, bx1, by) in hs[i + 1:]:
            if by - ay < 10 or abs(ax0 - bx0) > tol or abs(ax1 - bx1) > tol:
                continue
            left = any(abs(vx - ax0) <= tol and vy0 <= ay + tol and vy1 >= by - tol for vx, vy0, vy1 in vs)
            right = any(abs(vx - ax1) <= tol and vy0 <= ay + tol and vy1 >= by - tol for vx, vy0, vy1 in vs)
            if not (left and right):
                continue
            # 내부 가로선(같은 폭) 있으면 표 → 제외, 가장 가까운 bottom 하나만
            inner = any(ay + 1 < hy < by - 1 and hx0 <= ax0 + tol and hx1 >= ax1 - tol for hx0, hx1, hy in hs)
            innerv = any(ax0 + tol < vx < ax1 - tol and vy0 < by - 1 and vy1 > ay + 1 for vx, vy0, vy1 in vs)
            if inner or innerv:
                break
            r = (ax0, ay, ax1, by)
            if not any(_overlap(r, t) > 0.6 for t in table_rects):
                boxes.append(r)
            break
    return boxes


def _overlap(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    area = (a[2] - a[0]) * (a[3] - a[1])
    return (x1 - x0) * (y1 - y0) / area if area else 0.0


def _inside(cx, cy, r, pad=1.0):
    return r[0] - pad <= cx <= r[2] + pad and r[1] - pad <= cy <= r[3] + pad


def _cell_lines(page, rect):
    """셀 사각형 안의 텍스트 줄 [(y0, text)]"""
    out = []
    for b in page.get_text('dict', clip=rect)['blocks']:
        for l in b.get('lines', []):
            t = ''.join(s['text'] for s in l['spans'])
            if not t.strip():
                continue
            bb = l['bbox']
            cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
            if _inside(cx, cy, rect, 0.5):
                out.append((bb[1], bb[0], t))
    out.sort()
    # 같은 y 줄 합치기
    merged = []
    for y, x, t in out:
        if merged and abs(merged[-1][0] - y) < 2:
            merged[-1] = (merged[-1][0], merged[-1][1] + ' ' + t)
        else:
            merged.append((y, t))
    return merged


def join_wrapped(parts):
    """줄바꿈된 텍스트 결합: 앞줄 끝 공백 있으면 띄우고, 없으면 붙인다."""
    s = ''
    for t in parts:
        if not s:
            s = t
        elif s.endswith(' ') or t.startswith(' ') or re.search(r'(다\.|\.)$', s.rstrip()) and re.match(r'^[가-힣「【\(\-※]', t):
            s = s.rstrip() + ' ' + t.lstrip()
        else:
            s = s + t
    return re.sub(r'[  ]{2,}', ' ', s).strip()


def table_rows(page, tab):
    """표 → 행 리스트. 뭉친 행은 짧은 값 열 기준으로 재분할."""
    rows_out = []
    for row in tab.rows:
        cells = row.cells
        clines = []
        for c in cells:
            clines.append(_cell_lines(page, fitz_rect(c)) if c is not None else None)
        # 재분할 판단
        real = [cl for cl in clines if cl]
        anchor = None
        if len(cells) >= 2 and any(len(cl) > 1 for cl in real):
            best = None
            for ci, cl in enumerate(clines):
                if ci == 0 or not cl or len(cl) < 2:
                    continue
                if all(len(t.strip()) <= 14 for _, t in cl):
                    if best is None or len(cl) > len(clines[best]):
                        best = ci
            anchor = best
        if anchor is None:
            rows_out.append([join_wrapped([t for _, t in cl]) if cl else ('' if cl is not None else None) for cl in clines])
            continue
        ys = [y for y, _ in clines[anchor]]
        sub = [[[] for _ in cells] for _ in ys]
        for ci, cl in enumerate(clines):
            if not cl:
                continue
            for y, t in cl:
                k = 0
                for j, ay in enumerate(ys):
                    if y >= ay - 3:
                        k = j
                sub[k][ci].append(t)
        for sr in sub:
            rows_out.append([join_wrapped(x) if cells[ci] is not None else None for ci, x in enumerate(sr)])
    return rows_out


def fitz_rect(c):
    import fitz
    return fitz.Rect(c)


def page_elements(page, pno):
    W, H = page.rect.width, page.rect.height
    mid = W / 2
    tabs = page.find_tables().tables
    trects = [tuple(t.bbox) for t in tabs]
    boxes = find_boxes(page, trects)
    els = []
    for ti, t in enumerate(tabs):
        rows = table_rows(page, t)
        x0, y0, x1, y1 = t.bbox
        els.append({'kind': 'table', 'rows': rows, 'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'page': pno})
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            spans = [s for s in l['spans'] if s['text'].strip()]
            if not spans:
                continue
            t = ''.join(s['text'] for s in l['spans'])
            x0, y0, x1, y1 = l['bbox']
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            if spans[0]['font'].startswith(PAGE_NUM_FONT) and t.strip().isdigit() and y0 > H - 70:
                continue
            if any(_inside(cx, cy, r) for r in trects):
                continue
            if ARROWS.match(t):
                continue
            box = None
            for bi, r in enumerate(boxes):
                if _inside(cx, cy, r):
                    box = (pno, bi)
            els.append({'kind': 'line', 'text': t, 'size': round(max(s['size'] for s in spans), 1),
                        'font': spans[0]['font'], 'color': spans[0]['color'],
                        'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'box': box, 'page': pno})
    # 컬럼 배정 + 띠 분할
    for e in els:
        wide = e['x0'] < mid - 12 and e['x1'] > mid + 12
        e['col'] = -1 if wide else (0 if (e['x0'] + e['x1']) / 2 < mid else 1)
    wides = sorted([e for e in els if e['col'] == -1], key=lambda e: e['y0'])
    # 띠 경계: 넓은 요소들의 y 구간
    bands = []
    cur = -1e9
    for w in wides:
        bands.append((cur, w['y0']))
        cur = w['y1']
    bands.append((cur, 1e9))
    order = []
    wi = 0
    for bi, (by0, by1) in enumerate(bands):
        inband = [e for e in els if e['col'] != -1 and by0 - 2 <= (e['y0'] + e['y1']) / 2 < by1 + 2]
        for c in (0, 1):
            order += sorted([e for e in inband if e['col'] == c], key=lambda e: (e['y0'], e['x0']))
        if bi < len(wides):
            order.append(wides[bi])
    # 누락 방지
    seen = set(map(id, order))
    order += [e for e in els if id(e) not in seen]
    return order
