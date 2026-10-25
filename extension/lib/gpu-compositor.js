import { drawGeometry } from './model.js';

const vertexSource = [
  '#version 300 es',
  'in vec2 a_position;',
  'in vec2 a_texcoord;',
  'out vec2 v_texcoord;',
  'void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_texcoord = a_texcoord; }'
].join('\n');
const fragmentSource = [
  '#version 300 es',
  'precision highp float;',
  'uniform sampler2D u_frame;',
  'uniform float u_opacity;',
  'in vec2 v_texcoord;',
  'out vec4 outColor;',
  'void main() { vec4 pixel = texture(u_frame, v_texcoord); outColor = vec4(pixel.rgb, pixel.a * u_opacity); }'
].join('\n');

function gpuInfo(gl) {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) || '');
  const vendor = String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR) || '');
  const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer);
  return { backend: 'webgl2', renderer, vendor, hardware: software ? false : /NVIDIA|GeForce|Radeon|AMD|Intel|Apple|Adreno|Mali|PowerVR/i.test(renderer) ? true : null, powerPreference: gl.getContextAttributes()?.powerPreference || 'high-performance' };
}

export class GpuCompositor {
  constructor(canvas, gl) {
    this.canvas = canvas; this.gl = gl; this.textures = new Map(); this.vertices = new Float32Array(24); this.shaders = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(type); this.shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || '视频合成着色器初始化失败');
      }
      this.program = gl.createProgram(); for (const shader of this.shaders) gl.attachShader(this.program, shader);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) || '视频合成程序初始化失败');
      gl.useProgram(this.program); this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);
      for (const [name, offset] of [['a_position', 0], ['a_texcoord', 8]]) {
        const location = gl.getAttribLocation(this.program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset);
      }
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(gl.getUniformLocation(this.program, 'u_frame'), 0);
      this.opacity = gl.getUniformLocation(this.program, 'u_opacity');
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.info = gpuInfo(gl);
    } catch (error) { this.close(); throw error; }
  }
  draw(scene, frames) {
    const gl = this.gl, width = this.canvas.width, height = this.canvas.height;
    if (gl.isContextLost()) throw new Error('显卡合成上下文已重置');
    const color = scene.background.slice(1);
    gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, width, height);
    gl.clearColor(parseInt(color.slice(0, 2), 16) / 255, parseInt(color.slice(2, 4), 16) / 255, parseInt(color.slice(4, 6), 16) / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.enable(gl.SCISSOR_TEST);
    for (const id of scene.layers) {
      const settings = scene.sources[id], frame = frames.get(id);
      if (!settings.visible || !frame || settings.opacity <= 0) continue;
      let texture = this.textures.get(id);
      if (!texture) {
        texture = { object: gl.createTexture(), frame: null }; this.textures.set(id, texture); gl.bindTexture(gl.TEXTURE_2D, texture.object);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } else gl.bindTexture(gl.TEXTURE_2D, texture.object);
      // Reuse textures when an input has no new frame; no CPU pixel readback.
      if (texture.frame !== frame) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame); texture.frame = frame; }
      const inputWidth = frame.displayWidth, inputHeight = frame.displayHeight;
      const [sx, sy, sw, sh, dx, dy, dw, dh] = drawGeometry(settings, inputWidth, inputHeight, width, height);
      const left = dx / width * 2 - 1, right = (dx + dw) / width * 2 - 1, top = 1 - dy / height * 2, bottom = 1 - (dy + dh) / height * 2;
      const u0 = sx / inputWidth, u1 = (sx + sw) / inputWidth, v0 = sy / inputHeight, v1 = (sy + sh) / inputHeight;
      this.vertices.set([left, top, u0, v0, left, bottom, u0, v1, right, top, u1, v0, right, top, u1, v0, left, bottom, u0, v1, right, bottom, u1, v1]);
      const x0 = Math.max(0, Math.floor(settings.x / 100 * width)), x1 = Math.min(width, Math.ceil((settings.x + settings.w) / 100 * width));
      const y0 = Math.max(0, Math.floor(settings.y / 100 * height)), y1 = Math.min(height, Math.ceil((settings.y + settings.h) / 100 * height));
      gl.scissor(x0, height - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices); gl.uniform1f(this.opacity, settings.opacity / 100); gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.SCISSOR_TEST); gl.flush();
  }
  close() {
    const gl = this.gl;
    for (const texture of this.textures.values()) gl.deleteTexture(texture.object); this.textures.clear();
    if (this.buffer) gl.deleteBuffer(this.buffer); if (this.program) gl.deleteProgram(this.program);
    for (const shader of this.shaders) gl.deleteShader(shader); this.shaders.length = 0;
  }
}

class CanvasCompositor {
  constructor(canvas, reason) {
    this.canvas = canvas; this.context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!this.context) throw new Error('直播画面合成初始化失败');
    this.context.imageSmoothingEnabled = true; this.context.imageSmoothingQuality = 'high';
    this.info = { backend: 'canvas2d', renderer: '', vendor: '', hardware: null, reason };
  }
  draw(scene, frames) {
    const context = this.context, width = this.canvas.width, height = this.canvas.height;
    context.globalAlpha = 1; context.fillStyle = scene.background; context.fillRect(0, 0, width, height);
    for (const id of scene.layers) {
      const settings = scene.sources[id], frame = frames.get(id);
      if (!settings.visible || !frame) continue;
      context.save(); context.globalAlpha = settings.opacity / 100;
      context.beginPath(); context.rect(settings.x / 100 * width, settings.y / 100 * height, settings.w / 100 * width, settings.h / 100 * height); context.clip();
      context.drawImage(frame, ...drawGeometry(settings, frame.displayWidth, frame.displayHeight, width, height)); context.restore();
    }
  }
  close() {}
}

export function createCompositorRenderer(width, height, { Canvas = globalThis.OffscreenCanvas, preferGpu = true, reason = '' } = {}) {
  if (preferGpu) {
    const canvas = new Canvas(width, height); let gl, renderer;
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
      if (gl) { renderer = new GpuCompositor(canvas, gl); renderer.draw({ background: '#000000', layers: [] }, new Map()); return renderer; }
      reason = '当前浏览器使用通用合成';
    } catch (error) { reason = error.message; renderer?.close(); }
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return new CanvasCompositor(new Canvas(width, height), reason);
}
