import { test } from '@playwright/test';

const body = async () => {};

test('shared title', body);
test('login twice', body);
test('first login', body);
test.describe('outer', () => {
  test('same', body);
  test.describe('inner', () => {
    test('same', body);
    test.describe('third', () => {
      test('same', body);
    });
  });
});
test.describe('other', () => {
  test('same', body);
});
for (const index of [1, 2, 10]) test(`param ${index}`, body);
for (const index of [1, 2]) {
  test.describe(`group ${index}`, () => {
    test('in a loop', body);
  });
}
test('regex .*+?^$()[]{}|\\ all', body);
test('regex xxxxxxxxxxxxx()[]{}|\\ all', body);
test('double "quote"', body);
test("single 'quote'", body);
test('dollar $HOME $(whoami) ${x} end$', body);
test('backtick `id` end', body);
test('percent %PATH% 100%', body);
test('bang !! !x', body);
test('caret ^ amp & pipe | lt < gt >', body);
test('semi ; hash # tilde ~ star * question ?', body);
test('comma, equals= colon: slash/ back\\slash', body);
test('value >= 10', body);
test('value <= 10', body);
test('price €10', body);
test('price $10', body);
test('accents éàü ñ', body);
test('accents eau n', body);
test('日本語のタイトル', body);
test('日本語のテスト名', body);
test('emoji 🚀 ok', body);
test('heart ❤\ufe0f with a variation selector', body);
test('decomposed e\u0301 letter', body);
test('composed é letter', body);
test('हिन्दी with marks', body);
test('𝒜 outside the BMP', body);
test('dash — en – curly ’ “quoted”', body);
test('emoji 👩‍💻 joined', body);
test('tab\there', body);
test('new\nline', body);
test('trailing space ', body);
test('double  space', body);
test('-leading dash', body);
test(`L${'o'.repeat(1500)}ng`, body);
test(`L${'o'.repeat(1500)}ng2`, body);
