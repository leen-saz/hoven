// One source for colours (docs/PRD.md §4.2): public/assets/tokens.css. app.css and the shadcn styles only refer to tokens,
// and every token has a dark value, so dark mode cannot leave a light colour behind.
import { describe, expect, it } from 'vitest';
import tokens from '../../public/assets/tokens.css?raw';
import app from '../../public/assets/app.css?raw';
import ui from '../../src/styles/ui.css?raw';

const HEX = /#[0-9a-f]{3,8}\b/gi;
const block = (sel: string) => tokens.slice(tokens.indexOf(sel)).split('}')[0]!;
const names = (css: string) => [...css.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]).sort();

describe('colour tokens', () => {
  it('app.css and ui.css hold no colour of their own', () => {
    expect(app.match(HEX) ?? []).toEqual([]);
    expect(ui.match(HEX) ?? []).toEqual([]);
  });
  it('app.css loads the tokens first', () => {
    expect(app.trimStart().startsWith('@import url("/assets/tokens.css");')).toBe(true);
  });
  it('dark and automatic define every light token', () => {
    const light = names(block(':root{'));
    expect(light.length).toBeGreaterThan(10);
    expect(names(block(':root[data-theme=dark]{'))).toEqual(light);
    expect(names(block(':root[data-theme=auto]{'))).toEqual(light);
  });
  it('the forest green stays the one action colour in light mode', () => {
    expect(block(':root{')).toContain('--accent:#294036');
  });
});
