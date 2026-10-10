import { describe, it, expect } from 'vitest';
import * as m from './classic-styles';

describe('classic-styles', () => {
  it('classicStyles uses Arial, black, ruled tables', () => {
    const css = m.classicStyles();
    expect(css.includes('Arial'), 'has Arial').toBeTruthy();
    expect(css.includes('#000'), 'has black').toBeTruthy();
    expect(css.includes('border-collapse'), 'has ruled tables').toBeTruthy();
    expect(!/Inter|#2563eb|Source Serif/.test(css), 'no glass-era styles').toBeTruthy();
  });
  it('ruledTable emits one th per column and num class on right cols', () => {
    const html = m.ruledTable(
      [{ label: 'Desc' }, { label: 'Amt', align: 'right' }],
      [['Widget', '$1.00']]);
    expect(html.includes('<table class="ruled">')).toBeTruthy();
    expect(html.includes('<thead>'), 'has thead (repeats header across PDF pages)').toBeTruthy();
    expect((html.match(/<th[\s>]/g) || []).length).toBe(2);
    expect(html.includes('<td class="num">$1.00</td>')).toBeTruthy();
  });
  it('metaStrip escapes labels', () => {
    const html = m.metaStrip([{ label: '<x>', value: 'v' }]);
    expect(html.includes('&lt;x&gt;'), 'label escaped').toBeTruthy();
  });
  it('totalsBox marks grand row', () => {
    const html = m.totalsBox([{ label: 'Total', value: '$5', grand: true }]);
    expect(html.includes('<tr class="grand">')).toBeTruthy();
  });
  it('docHeader numberHtml passes trusted multi-line markup unescaped', () => {
    const html = m.docHeader({ coName: 'Co', coDetailHtml: '', title: 'Invoice', numberHtml: 'No. 7<br>[SENT]' });
    expect(html.includes('No. 7<br>[SENT]'), 'numberHtml not escaped').toBeTruthy();
    // plain `number` is still escaped:
    const esc2 = m.docHeader({ coName: 'Co', coDetailHtml: '', title: 'Invoice', number: '<b>' });
    expect(esc2.includes('&lt;b&gt;'), 'plain number escaped').toBeTruthy();
  });

  it('logoImg renders grayscale class for safe URLs, empty otherwise', () => {
    expect(m.logoImg('data:image/png;base64,xx').includes('class="doc-logo"'), 'data URI ok').toBeTruthy();
    expect(m.logoImg('https://x/y.png').includes('class="doc-logo"'), 'https ok').toBeTruthy();
    expect(m.logoImg('file:///etc/passwd')).toBe('');
    expect(m.logoImg(null)).toBe('');
  });
});
