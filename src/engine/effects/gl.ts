// A small WebGL2 runner for effect passes: full-screen fragment shaders reading textures and writing
// to pooled render targets. Works on an OffscreenCanvas, so the export worker uses it too.
// Convention: textures hold premultiplied RGBA with y up (uploads are flipped), shaders work in
// pixel coordinates (gl_FragCoord), and the final pass writes to the canvas itself.

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

export type Uniform = number | boolean | readonly number[];

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

interface Program {
  prog: WebGLProgram;
  loc: Map<string, WebGLUniformLocation | null>;
}

export class Gl {
  readonly canvas: OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  private readonly programs = new Map<string, Program>();
  private readonly free: Target[] = [];
  private readonly inputs: WebGLTexture[] = [];
  private readonly internalFormat: number;
  private readonly type: number;
  private w = 0;
  private h = 0;

  private constructor(canvas: OffscreenCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    // Half-float targets avoid banding in blurs and glows; fall back to 8 bits.
    const float = !!gl.getExtension('EXT_color_buffer_float');
    this.internalFormat = float ? gl.RGBA16F : gl.RGBA8;
    this.type = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  static create(): Gl | null {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
      return gl ? new Gl(canvas, gl) : null;
    } catch {
      return null;
    }
  }

  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }

  /** Match the size of the canvas being processed; targets of another size are dropped. */
  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    for (const t of this.free) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    this.free.length = 0;
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
  }

  private newTexture(internal: number, format: number, type: number) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.w) gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.w, this.h, 0, format, type, null);
    return tex;
  }

  /** A render target of the current size (return it with release()). */
  acquire(): Target {
    const t = this.free.pop();
    if (t) return t;
    const gl = this.gl;
    const tex = this.newTexture(this.internalFormat, gl.RGBA, this.type);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }

  release(t: Target | null | undefined) {
    if (t) this.free.push(t);
  }

  /** Upload an image (a canvas) into input slot `slot`, flipped to y up and premultiplied. */
  upload(source: TexImageSource, slot = 0): WebGLTexture {
    const gl = this.gl;
    let tex = this.inputs[slot];
    if (!tex) tex = this.inputs[slot] = this.newTexture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return tex;
  }

  /** A 256×1 lookup table (RGBA bytes), in its own slot. */
  uploadLut(data: Uint8Array, slot: number): WebGLTexture {
    const gl = this.gl;
    let tex = this.inputs[slot];
    if (!tex) tex = this.inputs[slot] = this.newTexture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, data.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  private program(frag: string): Program {
    let p = this.programs.get(frag);
    if (p) return p;
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}\n${src}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(prog)}`);
    p = { prog, loc: new Map() };
    this.programs.set(frag, p);
    return p;
  }

  /**
   * Run a fragment shader over the whole target. `textures` are bound to samplers by name;
   * `u_res` (the size in px) is always set. `out` null draws to the canvas.
   */
  run(frag: string, textures: Record<string, WebGLTexture>, uniforms: Record<string, Uniform>, out: Target | null) {
    const gl = this.gl;
    const p = this.program(frag);
    gl.useProgram(p.prog);
    const loc = (name: string) => {
      if (!p.loc.has(name)) p.loc.set(name, gl.getUniformLocation(p.prog, name));
      return p.loc.get(name)!;
    };
    let unit = 0;
    for (const [name, tex] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc(name), unit++);
    }
    gl.uniform2f(loc('u_res'), this.w, this.h);
    for (const [name, v] of Object.entries(uniforms)) {
      const l = loc(name);
      if (l === null) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (typeof v === 'boolean') gl.uniform1f(l, v ? 1 : 0);
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
      else if (v.length === 9) gl.uniformMatrix3fv(l, false, v as number[]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
    gl.viewport(0, 0, this.w, this.h);
    this.drawQuad();
  }

  private quad: WebGLBuffer | null = null;
  /** One triangle covering the viewport. */
  private drawQuad() {
    const gl = this.gl;
    if (!this.quad) {
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
