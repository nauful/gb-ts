import GB, { Button, GBTimer } from './gb';
import MMU from './/mmu';
import PPU from './ppu';
import 'index.less';

// https://github.com/CrossVR/emulator-shaders/blob/master/assets/lcd3x.shader

const shaderSourceVS: string = `
precision mediump float;
in vec2 pos;
out vec2 frag_texcoord;

void main() {
    vec2 screenpos = 2.0 * pos - vec2(1.0, 1.0);
    gl_Position = vec4(screenpos.xy, 0.0, 1.0);
    frag_texcoord.xy = vec2(pos.x, 1.0 - pos.y);
}
`

const shaderSourceFS: string = `
precision mediump float;
in vec2 frag_texcoord;
out vec4 frag_color;
uniform sampler2D tex;
uniform sampler2D tex_palette;
uniform sampler2D tex_grid;

void main() {
    const vec2 texsize = vec2(160.0, 144.0);

    float grid = texture(tex_grid, frag_texcoord * texsize).r;
    float pal0 = texture(tex, frag_texcoord.xy).r;
    pal0 = mix(1.0, pal0, grid);

    vec3 r_color = texture(tex_palette, vec2(pal0, 0.0)).rgb;
    frag_color = vec4(r_color, 1.0);
}
`

function glCreateProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
    const program = gl.createProgram();
    if (!program) {
        throw ('Unable to create program');
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw ('Unable to link program ' + gl.getProgramInfoLog(program));
    }

    return program;
}

function glCompileShader(gl: WebGL2RenderingContext, src: string, shaderType: GLenum): WebGLShader {
    const shader = gl.createShader(shaderType);
    if (!shader) {
        throw ('Unable to create shader of type ' + shaderType);
    }

    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw ('Unable to compile shader ' + src + ' ' + gl.getShaderInfoLog(shader));
    }

    return shader;
}

function updateClientSize() {
    const canvasElement = document.getElementById('gb-canvas') as HTMLCanvasElement;
    const scaleX = (document.body.clientWidth - 32) / 160;
    const scaleY = (document.body.clientHeight - 96) / 144;
    const scale = Math.floor(Math.max(1, Math.min(...[5, scaleX, scaleY])));
    canvasElement.width = 160 * scale;
    canvasElement.height = 144 * scale;
}

interface ROM {
    title: string,
    data: Uint8Array
}

async function sceneInit() {
    const roms: ROM[] = [
        { title: 'ROM: adjustris', data: new Uint8Array(await (await fetch('roms/adjtris.gb')).arrayBuffer()) },
        { title: 'ROM: Sheep It Up!', data: new Uint8Array(await (await fetch('roms/sheepitup.gb')).arrayBuffer()) },
        { title: 'ROM: gejmboj demo', data: new Uint8Array(await (await fetch('roms/gejmboj.gb')).arrayBuffer()) },
    ];

    updateClientSize();

    Array.from(document.getElementsByClassName('loading')).forEach((e: any) => e.style.display = 'none');
    Array.from(document.getElementsByClassName('loaded')).forEach((e: any) => e.style.display = 'inherit');

    let romIndex: number = 0;
    (document.getElementById('rom-title') as HTMLElement).textContent = roms[romIndex].title;
    let mmu = new MMU(new Uint8Array(roms[romIndex].data));
    let ppu = new PPU(mmu);
    let gb = new GB(mmu);
    let gbTimer = new GBTimer(mmu);

    const loadNewROM = () => {
        (document.getElementById('rom-title') as HTMLElement).textContent = roms[romIndex].title;
        mmu = new MMU(new Uint8Array(roms[romIndex].data));
        ppu = new PPU(mmu);
        gb = new GB(mmu);
        gbTimer = new GBTimer(mmu);
    };

    const canvasElement = document.getElementById('gb-canvas') as HTMLCanvasElement;
    const gl = canvasElement.getContext('webgl2') as WebGL2RenderingContext;

    const texRender = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texRender);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 160, 144, 0, gl.RED, gl.UNSIGNED_BYTE, null);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const texPalette = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texPalette);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, 4, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([
        // 0xFF, 0x00, 0x00,
        // 0x00, 0xFF, 0x00,
        // 0xFF, 0x00, 0xFF,
        // 0x00, 0x00, 0xFF,
        0x0F, 0x38, 0x0F,
        0x30, 0x62, 0x30,
        0x8B, 0xAC, 0x0F,
        0x9B, 0xBC, 0x0F,
    ]));

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const gridScale = 4;
    const texGrid = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texGrid);
    const gridData: number[] = [];
    for (let y = 0; y < gridScale; y++) {
        for (let x = 0; x < gridScale; x++) {
            gridData.push(x == 0 || y == 0 ? 0 : 0xFF);
        }
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gridScale, gridScale, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(gridData));

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    const shaderFS = glCompileShader(gl, '#version 300 es\n' + shaderSourceFS, gl.FRAGMENT_SHADER);
    const shaderVS = glCompileShader(gl, '#version 300 es\n' + shaderSourceVS, gl.VERTEX_SHADER);
    const shaderProg = glCreateProgram(gl, shaderVS, shaderFS);
    gl.useProgram(shaderProg);

    const vb = gl.createBuffer();
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0]), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    const attribPos = gl.getAttribLocation(shaderProg, 'pos');
    const uniformTex = gl.getUniformLocation(shaderProg, 'tex');
    const uniformTexPalette = gl.getUniformLocation(shaderProg, 'tex_palette');
    const uniformTexGrid = gl.getUniformLocation(shaderProg, 'tex_grid');
    gl.enableVertexAttribArray(attribPos);
    gl.vertexAttribPointer(attribPos, 2, gl.FLOAT, false, 2 * 4, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let accFrameCycles = 0;
    const maxFrameCycles = 17556;
    const animFrame = () => {
        while (accFrameCycles < maxFrameCycles) {
            const clks = gb.Step();
            ppu.Step(clks, true);
            gbTimer.Step(clks);
            accFrameCycles += clks;
        }
        accFrameCycles -= maxFrameCycles;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texPalette);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, texGrid);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texRender);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 160, 144, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(ppu.getFramebuffer()));

        gl.useProgram(shaderProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.enableVertexAttribArray(attribPos);
        gl.uniform1i(uniformTex, 0);
        gl.uniform1i(uniformTexPalette, 1);
        gl.uniform1i(uniformTexGrid, 2);

        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

        window.requestAnimationFrame(animFrame);
    };

    document.addEventListener('keydown', (ev: KeyboardEvent) => {
        switch (ev.code) {
            case 'ArrowUp': gb.ButtonOn(Button.Up); break;
            case 'ArrowDown': gb.ButtonOn(Button.Down); break;
            case 'ArrowLeft': gb.ButtonOn(Button.Left); break;
            case 'ArrowRight': gb.ButtonOn(Button.Right); break;
            case 'KeyX': gb.ButtonOn(Button.A); break;
            case 'KeyZ': gb.ButtonOn(Button.B); break;
            case 'Enter': gb.ButtonOn(Button.Start); break;
            case 'Backspace': gb.ButtonOn(Button.Select); break;

            case 'KeyN': romIndex = (romIndex == 0 ? (roms.length - 1) : (romIndex - 1)); loadNewROM(); break;
            case 'KeyM': romIndex = (romIndex + 1 == roms.length ? 0 : (romIndex + 1)); loadNewROM(); break;
            default:
        }
    });

    document.addEventListener('keyup', (ev: KeyboardEvent) => {
        switch (ev.code) {
            case 'ArrowUp': gb.ButtonOff(Button.Up); break;
            case 'ArrowDown': gb.ButtonOff(Button.Down); break;
            case 'ArrowLeft': gb.ButtonOff(Button.Left); break;
            case 'ArrowRight': gb.ButtonOff(Button.Right); break;
            case 'KeyX': gb.ButtonOff(Button.A); break;
            case 'KeyZ': gb.ButtonOff(Button.B); break;
            case 'Enter': gb.ButtonOff(Button.Start); break;
            case 'Backspace': gb.ButtonOff(Button.Select); break;
            default:
        }
    });

    window.requestAnimationFrame(animFrame);
}

if (document.readyState === 'complete') {
    sceneInit();
}
else {
    window.onload = (ev: Event) => sceneInit();
}

window.onresize = () => updateClientSize();
