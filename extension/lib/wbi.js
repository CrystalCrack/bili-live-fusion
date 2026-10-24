// WBI uses MD5 over sorted, escaped query parameters. This implementation is
// also exercised against standard MD5 vectors and the WBI reference vector.
export function md5(text) {
  const input = new TextEncoder().encode(text), size = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(size); bytes.set(input); bytes[input.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(size - 8, input.length * 8, true);
  view.setUint32(size - 4, Math.floor(input.length / 0x20000000), true);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < size; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      const group = i >>> 4;
      const f = group === 0 ? (b & c) | (~b & d) : group === 1 ? (d & b) | (~d & c) : group === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = group === 0 ? i : group === 1 ? (5 * i + 1) % 16 : group === 2 ? (3 * i + 5) % 16 : 7 * i % 16;
      const sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) + view.getUint32(offset + g * 4, true)) | 0;
      const shift = shifts[group * 4 + i % 4], rotate = sum << shift | sum >>> (32 - shift);
      [a, b, c, d] = [d, (b + rotate) | 0, b, c];
    }
    state = state.map((value, index) => (value + [a, b, c, d][index]) | 0);
  }
  return state.map(value => Array.from({ length: 4 }, (_, i) => ((value >>> (i * 8)) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
export function signWbi(params, images, now = Date.now()) {
  const key = ['img_url', 'sub_url'].map(field => images?.[field]?.split('/').at(-1)?.split('.')[0] || '').join('');
  if (key.length !== 64) throw new Error('直播服务签名初始化失败，请重连');
  const salt = MIXIN.map(index => key[index]).join('').slice(0, 32);
  const values = { ...params, wts: Math.floor(now / 1000) };
  const query = Object.keys(values).sort().map(name => `${encodeURIComponent(name)}=${encodeURIComponent(String(values[name]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${md5(query + salt)}`;
}
