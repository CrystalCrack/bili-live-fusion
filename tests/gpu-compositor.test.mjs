import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositorRenderer } from '../extension/lib/gpu-compositor.js';
import { accelerationStatus } from '../extension/lib/acceleration-status.js';
import { defaultScene, drawGeometry } from '../extension/lib/model.js';

function fixture({ unavailable = false, compileError = false, software = false } = {}) {
  const calls = [], canvases = [], shaders = []; let lost = false;
  const methods = ['attachShader', 'linkProgram', 'useProgram', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'activeTexture', 'uniform1i', 'enable', 'blendFunc', 'disable', 'viewport', 'clearColor', 'clear', 'bindTexture', 'texParameteri', 'texImage2D', 'scissor', 'uniform1f', 'drawArrays', 'flush', 'deleteTexture', 'deleteBuffer', 'deleteProgram', 'deleteShader'];
  const gl = Object.fromEntries(methods.map(name => [name, (...args) => { calls.push({ name, args }); }]));
  for (const name of ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ARRAY_BUFFER', 'DYNAMIC_DRAW', 'FLOAT', 'TEXTURE0', 'BLEND', 'SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'SCISSOR_TEST', 'COLOR_BUFFER_BIT', 'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'LINEAR', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'RGBA', 'UNSIGNED_BYTE', 'TRIANGLES', 'RENDERER', 'VENDOR']) gl[name] = name;
  Object.assign(gl, {
    createShader: type => ({ type }), shaderSource(shader, source) { shader.source = source; shaders.push(shader); }, compileShader() {},
    getShaderParameter: () => !compileError, getShaderInfoLog: () => 'compile failed', getProgramParameter: () => true,
    createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}), getAttribLocation: (_, name) => name === 'a_position' ? 0 : 1, getUniformLocation: (_, name) => name,
    bufferSubData: (_, __, vertices) => calls.push({ name: 'vertices', args: [Array.from(vertices)] }),
    getExtension(name) { return name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 'renderer', UNMASKED_VENDOR_WEBGL: 'vendor' } : name === 'WEBGL_lose_context' ? { loseContext() { lost = true; } } : null; },
    getParameter: name => name === 'renderer' ? software ? 'ANGLE SwiftShader Device' : 'ANGLE NVIDIA GeForce RTX' : 'Google Inc. (NVIDIA)',
    getContextAttributes: () => ({ powerPreference: 'high-performance' }), isContextLost: () => lost
  });
  const context2d = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, drawImage(...args) { calls.push({ name: 'drawImage', args }); } };
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
    getContext(type, options) { calls.push({ name: 'context', args: [type, options] }); return type === 'webgl2' ? unavailable ? null : gl : context2d; }
  }
  const renderer = createCompositorRenderer(1920, 1080, { Canvas });
  return { renderer, gl, calls, canvases, shaders, lose() { lost = true; } };
}
const frame = () => ({ displayWidth: 1920, displayHeight: 1080 });

test('GPU context requests high performance and reports the actual renderer rather than an installed device list', () => {
  const f = fixture();
  assert.equal(f.renderer.info.backend, 'webgl2'); assert.equal(f.renderer.info.hardware, true); assert.match(f.renderer.info.renderer, /NVIDIA/);
  const options = f.calls.find(call => call.name === 'context').args[1];
  assert.equal(options.powerPreference, 'high-performance'); assert.equal(options.failIfMajorPerformanceCaveat, true);
  assert.ok(f.shaders.every(shader => shader.source.startsWith('#version 300 es\n') && !shader.source.includes('\\n')));
  assert.equal(fixture({ software: true }).renderer.info.hardware, false);
});

test('GPU vertices preserve crop, aspect fit and upright UV coordinates for each source', () => {
  for (const fit of ['contain', 'cover', 'stretch']) {
    const f = fixture(), scene = defaultScene(), input = frame(); scene.layers = ['A'];
    Object.assign(scene.sources.A, { x: 10, y: 15, w: 55, h: 65, fit, opacity: 65, crop: { x: 20, y: 10, w: 60, h: 75 } });
    f.renderer.draw(scene, new Map([['A', input]]));
    const vertices = f.calls.find(call => call.name === 'vertices').args[0];
    const [sx, sy, sw, sh, dx, dy, dw, dh] = drawGeometry(scene.sources.A, 1920, 1080, 1920, 1080);
    const expected = [dx / 1920 * 2 - 1, 1 - dy / 1080 * 2, sx / 1920, sy / 1080];
    expected.forEach((value, i) => assert.ok(Math.abs(vertices[i] - value) < 1e-6));
    const bottomRight = [(dx + dw) / 1920 * 2 - 1, 1 - (dy + dh) / 1080 * 2, (sx + sw) / 1920, (sy + sh) / 1080];
    bottomRight.forEach((value, i) => assert.ok(Math.abs(vertices[20 + i] - value) < 1e-6));
    assert.equal(f.calls.filter(call => call.name === 'drawArrays').length, 1);
    assert.equal(f.calls.find(call => call.name === 'uniform1f').args[1], .65);
    assert.deepEqual(f.calls.find(call => call.name === 'scissor').args, [192, 216, 1056, 702]);
  }
});

test('only new input frames upload textures and rendering follows source layer order', () => {
  const f = fixture(), scene = defaultScene(), a = frame(), b = frame(), frames = new Map([['A', a], ['B', b]]);
  scene.layers = ['B', 'A']; f.renderer.draw(scene, frames); f.renderer.draw(scene, frames);
  assert.deepEqual(f.calls.filter(call => call.name === 'texImage2D').map(call => call.args.at(-1)), [b, a]);
  frames.set('A', frame()); f.renderer.draw(scene, frames);
  assert.equal(f.calls.filter(call => call.name === 'texImage2D').length, 3);
  f.renderer.close(); assert.equal(f.calls.filter(call => call.name === 'deleteTexture').length, 2);
  assert.equal(f.calls.filter(call => call.name === 'deleteShader').length, 2);
});

test('unavailable GPU and shader errors retain a separate usable canvas context', () => {
  for (const options of [{ unavailable: true }, { compileError: true }]) {
    const f = fixture(options), input = frame();
    assert.equal(f.renderer.info.backend, 'canvas2d'); assert.equal(f.canvases.length, 2);
    f.renderer.draw(defaultScene(), new Map([['A', input]])); assert.equal(f.calls.find(call => call.name === 'drawImage').args[0], input);
  }
  const f = fixture(); f.lose(); assert.throws(() => f.renderer.draw(defaultScene(), new Map()), /上下文已重置/);
});

test('acceleration labels expose measured encoding information and omit unavailable numbers', () => {
  assert.equal(accelerationStatus({}), null);
  const result = accelerationStatus({ producer: { compositor: { renderer: { backend: 'webgl2', renderer: 'NVIDIA RTX', hardware: true } }, encoding: { codec: 'video/H264', implementation: 'MediaFoundation', powerEfficient: true, width: 1920, height: 1080, fps: 59.8, bitrateMbps: 18.2 } } });
  assert.equal(result.title, 'GPU · WebGL2 合成'); assert.equal(result.device, 'NVIDIA RTX'); assert.match(result.details, /MediaFoundation/); assert.match(result.details, /59.8 帧/); assert.match(result.details, /18.2 Mbps/);
  const generic = accelerationStatus({ producer: { compositor: { renderer: { backend: 'canvas2d' } }, encoding: { powerEfficient: null, fps: null } } });
  assert.equal(generic.title, 'Canvas 合成'); assert.equal(generic.details, 'Edge 自动编码');
});
