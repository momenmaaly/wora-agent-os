import { deepEqual, equal, ok } from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../docs/audits/design-system-v1/', import.meta.url));
const pngSize = (name) => {
  const data = readFileSync(`${dir}${name}`);
  equal(data.subarray(1, 4).toString(), 'PNG', `${name} is a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

test('design-system evidence is complete and uses consistent desktop and mobile dimensions', () => {
  const expected = [
    'activity-light-ar.png', 'execution-dark-ar.png', 'execution-light-ar.png', 'execution-light-en.png',
    'execution-mobile-ar.png', 'home-dark-ar.png', 'home-light-ar.png', 'home-light-en.png',
    'home-mobile-dark-ar.png', 'home-mobile-light-ar.png',
  ];
  deepEqual(readdirSync(dir).filter((name) => name.endsWith('.png')).sort(), expected.sort());
  ok(!existsSync(`${dir}home-mobile-ar.png`), 'ambiguous mobile capture name is gone');
  for (const name of expected.filter((item) => !item.includes('mobile'))) {
    const { width, height } = pngSize(name);
    equal(width, 1440, `${name} desktop width`);
    ok([1000, 1500].includes(height), `${name} uses an intentional full-page height`);
  }
  for (const name of expected.filter((item) => item.includes('mobile'))) {
    const { width, height } = pngSize(name);
    equal(width, 390, `${name} mobile width`);
    equal(height, 844, `${name} mobile height`);
  }
});
