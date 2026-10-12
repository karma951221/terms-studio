#!/usr/bin/env python3
"""목차(TOC) ↔ 추출 제목 대조. 사용: python verify_structure.py OUTDIR/_structure.json"""
import json
import re
import sys

S = json.load(open(sys.argv[1]))
norm = lambda s: re.sub(r'[\s ]', '', s).replace('ㆍ', '･').replace('·', '･')


def key(kind, text):
    t = norm(text)
    if kind == '조':
        m = re.match(r'(제\d+조(?:의\d+)?)', t)
        return m.group(1) if m else t
    if kind == '별표':
        m = re.match(r'【(별표[\d\-]+)】', t)
        return m.group(1) if m else t
    return t


report = []
units = S['units']
for u in units:
    # TOC 기대값
    exp = []
    for e in S['toc']:
        pass
heads = S['headings']
# 단위별 TOC 항목을 다시 모으기 (toc 리스트를 제목 기준으로 나눔)
parts, cur = [], None
for r in S['toc']:
    if r.get('title'):
        cur = {'title': r['text'], 'entries': []}
        parts.append(cur)
    elif cur:
        cur['entries'].append(r)


def toc_kind(t):
    if re.match(r'^제\d+조', t):
        return '조'
    if re.match(r'^【별표', t):
        return '별표'
    if re.match(r'^\d+(-\d+)?\.', t) and '특별약관' in t:
        return '특약'
    if re.match(r'^제\d+관', t):
        return '관'
    if '특별약관' in t and not t.startswith(('Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ')):
        return '특약'
    return None


# 파일 묶음: 주계약(보통약관+특별약관 파트) / 제도성 / 독립특약 순서대로
groups = [('main', parts[0]['entries'] + parts[1]['entries']), ('inst', parts[2]['entries'])]
for i, p in enumerate(parts[3:]):
    groups.append((f'ind{i + 1:02d}', p['entries']))
file_of_unit = {}
for h in heads:
    f = h['file']
    u = 'main' if f.startswith('00_주계약/0') and not f.endswith('09_기타제도성특별약관') else (
        'inst' if f.endswith('09_기타제도성특별약관') else 'ind' + f.split('_')[0])
    file_of_unit.setdefault(u, []).append(h)

total_miss = 0
for uid, entries in groups:
    exp = [(toc_kind(e['text']), key(toc_kind(e['text']), e['text']), e['printed'] + 1)
           for e in entries if toc_kind(e['text']) and not ('법규' in e['text'])]
    got, zone = [], None
    for h in file_of_unit.get(uid, []):
        if h['kind'] in ('절', '특약', 'group'):
            zone = h['text']
        if h['kind'] == '조' and not (h['file'].endswith('01_보통약관') or (zone or '').startswith('제1절')):
            continue
        if h['kind'] in ('조', '별표', '특약', '관'):
            got.append((h['kind'], key(h['kind'], h['text']), h['pdf']))
    # 순서 무시 다중집합 대조
    from collections import Counter
    ce = Counter((k, t) for k, t, _ in exp)
    cg = Counter((k, t) for k, t, _ in got)
    miss = ce - cg
    extra = cg - ce
    kinds = Counter(k for k, _, _ in exp)
    gk = Counter(k for k, _, _ in got)
    print(f'== {uid}: 기대 {dict(kinds)} / 추출 {dict(gk)} / 누락 {sum(miss.values())} / 초과 {sum(extra.values())}')
    for (k, t), c in list(miss.items())[:15]:
        pg = [p for kk, tt, p in exp if kk == k and tt == t][0]
        print('   누락', k, t[:60], 'pdf', pg)
    for (k, t), c in list(extra.items())[:15]:
        pg = [p for kk, tt, p in got if kk == k and tt == t][0]
        print('   초과', k, t[:60], 'pdf', pg)
    total_miss += sum(miss.values())
print('TOTAL 누락', total_miss)
