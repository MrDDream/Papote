import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usedKeys } from '../scripts/i18n-keys.mjs';

const en = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'i18n', 'en.json'), 'utf8'));

describe('English translation', () => {
  it('covers every text of the web and Android apps', () => {
    const missing = [...usedKeys()].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it('keeps the placeholders of each text', () => {
    const count = (s) => (s.match(/\{\d*\}/g) ?? []).length;
    expect(Object.entries(en).filter(([fr, text]) => count(fr) !== count(text))).toEqual([]);
  });
});
