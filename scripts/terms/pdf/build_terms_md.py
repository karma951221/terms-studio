#!/usr/bin/env python3
"""무배당 알파Plus보장보험2607 약관 PDF → 구조화 Markdown + 구조 JSON.

사용: python build_terms_md.py PDF OUTDIR
  1) 인쇄 목차(PDF 37~89쪽) 파싱 → 단위(주계약 보통약관·특별약관 대분류·별표·제도성 / 독립특약) 쪽 범위
  2) 단위별 쪽 범위 요소 스트림(pdf_layout) → 문단·제목·표 블록
  3) 블록 → Markdown 파일 + structure.json (특약·별표·관·조 목록과 쪽)
대상 외: 앞부분 안내문·가이드북·약관요약서, 가입자 유의사항·주요내용 요약서·보험용어 해설, 인용 법규, 표지.
"""
import json
import os
import re
import sys

import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_layout import page_elements, join_wrapped  # noqa: E402

PAGE_OFFSET = 1          # PDF 쪽 = 인쇄 쪽 + 1
TOC_PAGES = range(37, 90)  # 1-base

RE_ROMAN = re.compile(r'^([ⅠⅡⅢⅣⅤⅥⅦ])\s*\.\s*(.+)$')
RE_절 = re.compile(r'^제\s*(\d+)\s*절\s*(.*)$')
RE_관 = re.compile(r'^제\s*(\d+)\s*관\s*(.*)$')
RE_조 = re.compile(r'^(제\s*\d+\s*조(?:의\s*\d+)?)\s*\(')
RE_특약번호 = re.compile(r'^(\d+(?:-\d+)?)\s*\.\s*(.+)$')
RE_별표라벨 = re.compile(r'^【\s*(별표\s*[\d\-]*)\s*】\s*(.*)$')
RE_붙임 = re.compile(r'^<\s*붙임\s*>')
MOK = '가나다라마바사아자차카타파하'
RE_MOK = re.compile(r'^([가-하])[\.\)]\s')
PARA_START = re.compile(
    r'^(\uf000|[①-⑳]|\d{1,2}\)|\(\d{1,2}\)|\d{1,2}\.(?!\d)|\([가-하]\)|-\s|－|※|·|ㆍ|•|○|□|■|▶|【|주\d+\)|<|〈)')
SENT_END = re.compile(r'(다\.|니다\.|\.|:|함|음|것)\s*$')
COL_RIGHT = {0: 262, 1: 489}


# ───────────────────────── 목차 ─────────────────────────
def parse_toc(doc):
    rows = []
    for pno in TOC_PAGES:
        p = doc[pno - 1]
        lines = []
        for b in p.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                t = ''.join(s['text'] for s in l['spans']).strip()
                if t:
                    lines.append((round(l['bbox'][1]), l['bbox'][0], t))
        lines.sort()
        for y, x, t in lines:
            if t.isdigit() and x > 200:   # 목차 쪽번호
                continue
            if t.replace(' ', '') == '목차':
                continue
            m = re.match(r'^(.*?)\s*\.{3,}\s*(\d+)\s*$', t)
            if m:
                rows.append({'toc_pdf': pno, 'x': round(x), 'text': m.group(1).strip(), 'printed': int(m.group(2))})
            else:
                rows.append({'toc_pdf': pno, 'x': round(x), 'text': t, 'printed': None})
    # 줄바꿈된 항목 결합(쪽번호 없는 x=54 줄 + 다음 줄)
    out, buf = [], None
    for r in rows:
        if r['printed'] is None and r['x'] <= 60:
            buf = r if buf is None else {**buf, 'text': buf['text'] + ' ' + r['text']}
            continue
        if buf is not None and r['printed'] is not None and r['x'] <= 60:
            r = {**r, 'text': buf['text'] + ' ' + r['text']}
            buf = None
        elif buf is not None:
            out.append(buf)
            buf = None
        out.append(r)
    # 제목(x>60, 쪽번호 없음) 연속 결합
    res = []
    for r in out:
        if r['printed'] is None and res and res[-1]['printed'] is None and res[-1].get('title'):
            res[-1]['text'] += ' ' + r['text']
            continue
        if r['printed'] is None:
            r['title'] = True
        res.append(r)
    for r in res:
        if r['printed'] is not None:
            r['pdf'] = r['printed'] + PAGE_OFFSET
    return res


def plan_units(toc, npages):
    """목차 → 파일 단위 계획."""
    parts, cur = [], None
    for r in toc:
        if r.get('title'):
            cur = {'title': r['text'], 'entries': []}
            parts.append(cur)
        elif cur is not None:
            cur['entries'].append(r)
    units = []
    main_title = None
    for pi, part in enumerate(parts):
        t = part['title']
        e = part['entries']
        if t.endswith('보통약관') and '알파Plus' in t:
            main_title = t.replace(' 보통약관', '')
            gwan1 = next(x for x in e if RE_관.match(x['text']))
            units.append({'id': 'main', 'kind': 'main_body', 'title': main_title, 'start': gwan1['pdf'], 'entries': e})
        elif t.endswith('특별약관') and '알파Plus' in t:
            units[-1]['entries'] += e
            law = next(x for x in e if x['text'].startswith('Ⅶ'))
            units[-1]['end'] = law['pdf'] - 1
        elif t == '기타 제도성 특별약관':
            units.append({'id': 'inst', 'kind': 'institutional', 'title': t, 'start': e[0]['pdf'], 'entries': e})
        else:
            # 독립특약
            sec1 = next(x for x in e if RE_절.match(x['text']))
            notice = next(x for x in e if x['text'].startswith('가입자 유의사항'))
            units.append({'id': f'ind{len([u for u in units if u["kind"] == "independent"]) + 1:02d}',
                          'kind': 'independent', 'title': t, 'start': sec1['pdf'], 'notice_pdf': notice['pdf'],
                          'entries': e})
    # end 계산
    for i, u in enumerate(units):
        if 'end' in u:
            continue
        nxt = units[i + 1] if i + 1 < len(units) else None
        if nxt is None:
            u['end'] = None
        elif nxt['kind'] == 'independent':
            u['end'] = nxt['notice_pdf'] - 2   # 독립특약 표지 직전
        else:
            u['end'] = nxt['start'] - 1
    return units


# ───────────────────────── 스트림 → 블록 ─────────────────────────
def merge_baseline(els):
    """같은 기준선(같은 컬럼)에 나뉜 줄을 x순으로 합친다."""
    out = []
    for e in els:
        if (e['kind'] == 'line' and out and out[-1]['kind'] == 'line' and out[-1]['col'] == e['col']
                and out[-1]['page'] == e['page'] and out[-1]['box'] == e['box']
                and abs((out[-1]['y0'] + out[-1]['y1']) / 2 - (e['y0'] + e['y1']) / 2) < 2.6):
            a, b = (out[-1], e) if out[-1]['x0'] <= e['x0'] else (e, out[-1])
            gap = b['x0'] - a['x1']
            sep = '' if (a['text'].endswith('\uf000') or gap < 1.5) else ' '
            merged = dict(a)
            merged['text'] = a['text'].rstrip() + sep + b['text'] if sep else a['text'] + b['text']
            merged['x1'] = max(a['x1'], b['x1'])
            merged['size'] = max(a['size'], b['size'])
            out[-1] = merged
        else:
            out.append(e)
    return out


def is_heading_line(e):
    if e['kind'] != 'line':
        return False
    t = e['text'].strip()
    if e['size'] >= 14.5:
        return False  # 표지
    if e['size'] >= 10.8 and not t.startswith('\uf000') and not t.startswith('【') and e['box'] is None:
        return True
    return False


def stream_blocks(doc, start, end, stop_at=None):
    els = []
    for p in range(start, end + 1):
        pe = page_elements(doc[p - 1], p)
        els += merge_baseline(pe)
    blocks = []      # {'t':'h'|'p'|'table', ...}
    para = None

    def flush():
        nonlocal para
        if para:
            txt = join_wrapped(para['parts'])
            if txt:
                blocks.append({'t': 'p', 'text': txt, 'box': para['box'] is not None, 'page': para['page']})
        para = None

    i = 0
    n = len(els)
    mok_next = 0
    jo_last = None
    while i < n:
        e = els[i]
        if e['kind'] == 'table':
            flush()
            blocks.append({'t': 'table', 'rows': e['rows'], 'page': e['page']})
            i += 1
            continue
        t = e['text']
        ts = t.strip()
        if e['size'] >= 14.5 or not ts:
            i += 1
            continue
        if stop_at and ts.startswith(stop_at):
            break
        # 제목(크게 쓴 줄) — 연속 큰 줄 결합
        if is_heading_line(e):
            flush()
            parts = [t]
            j = i + 1
            while (j < n and is_heading_line(els[j]) and els[j]['col'] == e['col']
                   and abs(els[j]['size'] - e['size']) < 0.6 and els[j]['y0'] - els[j - 1]['y1'] < 12
                   and not RE_관.match(els[j]['text'].strip()) and not RE_ROMAN.match(els[j]['text'].strip())
                   and not RE_특약번호.match(els[j]['text'].strip())):
                parts.append(els[j]['text'])
                j += 1
            blocks.append({'t': 'h', 'text': join_wrapped(parts), 'size': e['size'], 'page': e['page']})
            if not RE_관.match(parts[0].strip()):
                jo_last = None
            i = j
            continue
        # 별표 라벨
        m = RE_별표라벨.match(ts)
        if m and e['box'] is None and (not m.group(2) or re.search(r'(표|계산|기준)\s*$', m.group(2))):
            flush()
            label = m.group(1).replace(' ', '')
            title = m.group(2).strip()
            j = i + 1
            if not title:
                parts = []
                while j < n and is_heading_line(els[j]) and len(parts) < 3:
                    parts.append(els[j]['text'])
                    j += 1
                title = join_wrapped(parts)
            blocks.append({'t': 'h', 'text': f'【{label}】 {title}'.strip(), 'kind': '별표', 'label': label,
                           'title': title, 'page': e['page']})
            i = j
            continue
        # 조 제목(괄호 균형까지)
        if RE_조.match(ts) and e['box'] is None:
            parts = [t]
            j = i + 1
            while _depth(join_wrapped(parts)) > 0 and j < n and els[j]['kind'] == 'line' and j - i < 4:
                parts.append(els[j]['text'])
                j += 1
            full = join_wrapped(parts)
            head, rest = _split_title(full)
            num = _jo_num(head)
            prev = els[i - 1] if i > 0 else None
            gap_ok = (prev is None or prev['page'] != e['page'] or prev['col'] != e['col']
                      or prev['kind'] == 'table' or e['y0'] - prev['y1'] > 5.5)
            seq_ok = jo_last is None or num in (jo_last, jo_last + 1) or num == 1 or (num > jo_last and num - jo_last <= 3)
            if gap_ok and len(rest) <= 2 and seq_ok:
                flush()
                blocks.append({'t': 'h', 'text': head, 'kind': '조', 'page': e['page']})
                mok_next = 0
                jo_last = num
                i = j
                continue
        # 일반 문단 (목 가./나./다. 는 순서가 맞을 때만 새 문단 — "다. 그러나" 류 오인 방지)
        mok_start = False
        mm = RE_MOK.match(ts)
        if mm:
            k = MOK.index(mm.group(1)) if mm.group(1) in MOK else -1
            if k == 0 or k == mok_next:
                mok_start = True
                mok_next = k + 1
        new = para is None or para['box'] != e['box'] or PARA_START.match(ts) or mok_start \
            or (para['last']['kind'] == 'line' and _short_end(para['last']))
        if new:
            flush()
            para = {'parts': [t], 'box': e['box'], 'page': e['page'], 'last': e}
        else:
            para['parts'].append(t)
            para['last'] = e
        i += 1
    flush()
    return blocks


def _jo_num(h):
    m = re.match(r'제(\d+)조', h)
    return int(m.group(1)) if m else -1


def _depth(s):
    return s.count('(') - s.count(')')


def _split_title(s):
    d = 0
    for k, ch in enumerate(s):
        if ch == '(':
            d += 1
        elif ch == ')':
            d -= 1
            if d == 0:
                return re.sub(r'\s+', '', s[:k + 1].split('(')[0]) + s[s.index('('):k + 1], s[k + 1:].strip()
    return s.strip(), ''


def _short_end(e):
    col = e['col'] if e['col'] in (0, 1) else 1
    t = e['text'].rstrip()
    return e['x1'] < COL_RIGHT[col] - 22 and bool(SENT_END.search(t))


# ───────────────────────── 블록 → MD ─────────────────────────
RANK = {'file': 0, 'group': 1, '절': 1, '특약': 2, '별표': 2, '관': 3, '조': 4, '붙임': 3}


def classify(b):
    if b['t'] != 'h':
        return b
    if b.get('kind'):
        return b
    t = b['text']
    if RE_ROMAN.match(t):
        b['kind'] = 'group'
    elif RE_절.match(t):
        b['kind'] = '절'
    elif RE_관.match(t):
        b['kind'] = '관'
    elif RE_특약번호.match(t) and '특별약관' in t:
        b['kind'] = '특약'
    elif '특별약관' in t and len(t) < 90:
        b['kind'] = '특약'
    elif RE_붙임.match(t):
        b['kind'] = '붙임'
    else:
        b['kind'] = 'title'   # 분류 불가 큰 글씨(별표 제목 등) → 굵은 문단
    return b


def md_table(rows):
    rows = [r for r in rows if any((c or '').strip() for c in r)]
    if not rows:
        return [], []
    extra = []
    clean = []
    for r in rows:
        nonempty = [c for c in r if c]
        if len(r) > 1 and len(nonempty) == 1 and r[0] and r[0].startswith('【') and all(c is None for c in r[1:]):
            extra.append(r[0])
            continue
        clean.append(r)
    if not clean:
        return [], extra
    ncol = max(len(r) for r in clean)

    def cell(c):
        return (c or '').replace('|', '\\|').replace('\n', ' ').strip()
    out = ['| ' + ' | '.join(cell(c) for c in clean[0]) + ' |', '|' + '---|' * ncol]
    for r in clean[1:]:
        out.append('| ' + ' | '.join(cell(c) for c in r) + ' |')
    return out, extra


class Writer:
    def __init__(self):
        self.files = {}
        self.cur = None
        self.open = {}
        self.hang = 0
        self.last_page = None
        self.last_table_header = None
        self.struct = []

    def start(self, key, title, meta):
        self.cur = key
        self.files[key] = {'title': title, 'lines': [f'# {title}', '', meta, '']}
        self.open = {0: True}
        self.hang = 0
        self.last_page = None
        self.last_table_header = None

    def heading(self, kind, text, page):
        r = RANK[kind]
        for k in list(self.open):
            if k >= r:
                del self.open[k]
        level = 1 + len([k for k in self.open if k < r])
        self.open[r] = True
        self.hang = 0
        self.page(page)
        self.files[self.cur]['lines'] += ['', '#' * min(level, 6) + ' ' + text, '']
        self.last_table_header = None
        self.struct.append({'file': self.cur, 'kind': kind, 'level': level, 'text': text, 'pdf': page})

    def page(self, p):
        if p != self.last_page:
            self.files[self.cur]['lines'].append(f'<!-- p.{p} -->')
            self.last_page = p

    def para(self, text, box, page):
        self.page(page)
        if text.startswith('\uf000'):
            self.hang += 1
            text = f'[{self.hang}] ' + text[1:].lstrip()
        text = text.replace('\uf000', '')
        if re.match(r'^\d{1,2}\.\s', text):
            text = re.sub(r'^(\d{1,2})\.', r'\1\\.', text)   # 자동 번호 목록 방지
        if box:
            self.files[self.cur]['lines'] += ['> ' + text, '']
        else:
            self.files[self.cur]['lines'] += [text, '']
        self.last_table_header = None

    def table(self, rows, page):
        self.page(page)
        md, extra = md_table(rows)
        if md:
            hdr = md[0]
            if self.last_table_header == hdr:   # 쪽·단 넘김 표 이어붙이기(반복 머리글 제거)
                L = self.files[self.cur]['lines']
                while L and (L[-1] == '' or L[-1].startswith('<!--')):
                    L.pop()
                L += md[2:] + ['']
            else:
                self.files[self.cur]['lines'] += md + ['']
            self.last_table_header = hdr
        for x in extra:
            self.files[self.cur]['lines'] += ['> ' + x, '']


def safe(s):
    s = re.sub(r'[\\/:*?"<>|]', '_', s)
    return re.sub(r'\s+', '', s)


def main():
    pdf, outdir = sys.argv[1], sys.argv[2]
    doc = fitz.open(pdf)
    toc = parse_toc(doc)
    units = plan_units(toc, len(doc))
    os.makedirs(outdir, exist_ok=True)
    w = Writer()
    src = os.path.basename(pdf)
    for u in units:
        if u['end'] is None:
            idx = next(e for e in u['entries'] if '색인' in e['text']) if any('색인' in e['text'] for e in u['entries']) else None
            u['end'] = (idx['pdf'] - 1) if idx else len(doc)
            # 가나다순 색인 쪽 탐색
            for p in range(u['start'], len(doc) + 1):
                if '가나다순 특별약관 색인' in doc[p - 1].get_text():
                    u['end'] = p - 1
                    break
        blocks = [classify(b) for b in stream_blocks(doc, u['start'], u['end'], stop_at='【법규')]
        meta = f'> 원본: {src} · PDF p.{u["start"]}–{u["end"]} · 추출 2026-10-12 · build_terms_md.py (PyMuPDF)'
        if u['kind'] == 'main_body':
            base = '00_주계약'
            w.start(f'{base}/01_보통약관', f'{u["title"]} 보통약관', meta)
            seq = 1
            in_annex = False
            for b in blocks:
                if b['t'] == 'h' and b['kind'] == 'group':
                    seq += 1
                    m = RE_ROMAN.match(b['text'])
                    if '별표' in m.group(2):
                        in_annex = True
                        w.start(f'{base}/{seq:02d}_별표', f'{u["title"]} — 별표', meta)
                        continue
                    w.start(f'{base}/{seq:02d}_특별약관_{m.group(1)}_{safe(m.group(2)).replace("특별약관", "")}',
                            f'{u["title"]} 특별약관 — {b["text"]}', meta)
                    continue
                if b['t'] == 'h' and b['kind'] == '별표' and not in_annex and seq > 1:
                    in_annex = True
                    seq += 1
                    w.start(f'{base}/{seq:02d}_별표', f'{u["title"]} — 별표', meta)
                emit(w, b)
        elif u['kind'] == 'institutional':
            w.start('00_주계약/09_기타제도성특별약관', f'기타 제도성 특별약관 ({units[0]["title"]})', meta)
            annex_started = False
            for b in blocks:
                if b['t'] == 'h' and b['kind'] == '별표' and not annex_started:
                    annex_started = True
                    w.heading('group', '별표', b['page'])
                emit(w, b)
        else:
            num = u['id'][3:]
            w.start(f'{num}_{safe(u["title"])}', u['title'], meta)
            annex_started = False
            for b in blocks:
                if b['t'] == 'h' and b['kind'] == '별표' and not annex_started:
                    annex_started = True
                    w.heading('group', '별표', b['page'])
                emit(w, b)
    for key, f in w.files.items():
        path = os.path.join(outdir, key + '.md')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        txt = '\n'.join(f['lines'])
        txt = re.sub(r'\n{3,}', '\n\n', txt)
        open(path, 'w').write(txt.rstrip() + '\n')
    json.dump({'units': [{k: v for k, v in u.items() if k != 'entries'} for u in units],
               'toc': toc, 'headings': w.struct},
              open(os.path.join(outdir, '_structure.json'), 'w'), ensure_ascii=False, indent=1)
    print('files', len(w.files))


def emit(w, b):
    if b['t'] == 'h':
        k = b['kind']
        if k == 'title':
            w.para('**' + b['text'] + '**', False, b['page'])
            return
        if k == 'group':
            k = 'group'
        w.heading(k, b['text'], b['page'])
    elif b['t'] == 'p':
        w.para(b['text'], b['box'], b['page'])
    else:
        w.table(b['rows'], b['page'])


if __name__ == '__main__':
    main()
