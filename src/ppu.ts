import GB, { IOInterrupt } from "./gb";
import MMU, { MMUBase, IORegister } from "./mmu";

export const enum PPUState {
    OAM = 0,
    PixelTransfer,
    HBlank,
    VBlank
}

export interface PPUSprite {
    x: number;
    pixels: number[];
    attr: number;
}

export default class PPU {
    public static BUF_WIDTH = 160;
    public static BUF_HEIGHT = 144;

    private mmu: MMU;

    private state: PPUState;
    private stateTicks: number;

    private scanlineSprites: PPUSprite[];

    private backbuffer: Uint8Array;
    private framebuffer: Uint8Array;

    constructor(mmu: MMU) {
        this.mmu = mmu;

        this.state = PPUState.OAM;
        this.stateTicks = 0;

        this.scanlineSprites = [];

        this.framebuffer = new Uint8Array(PPU.BUF_WIDTH * PPU.BUF_HEIGHT);
        this.backbuffer = new Uint8Array(PPU.BUF_WIDTH * PPU.BUF_HEIGHT);
    }

    getFramebuffer(): Uint8Array {
        return this.framebuffer;
    }

    private ppuLinePixel(line: number[], x: number): number {
        return (((line[0] << x) & 0x80) >> 7) | (((line[1] << x) & 0x80) >> 6);
    }

    private ppuTileLineAddress(idx: number, y: number, lowBank: boolean) {
        const addr = lowBank ? (idx << 4) : (0x1000 + (GB.toUnsigned8(idx) << 4));

        return addr + (y << 1);
    }

    private ppuPixel(hiMap: boolean, loTiles: boolean, x: number, y: number) {
        const tileIdx = this.mmu.read(MMUBase.VRAM + (hiMap ? 0x1C00 : 0x1800) + ((y >> 3) << 5) + (x >> 3));
        const addr = this.ppuTileLineAddress(tileIdx, y & 7, loTiles);
        return this.ppuLinePixel(
            [this.mmu.read(0x8000 + addr),
            this.mmu.read(0x8000 + addr + 1)],
            x & 7);
    }

    private ppuPaletteResolve(pixel: number, pal: number) {
        pixel &= 0x3;
        return (pal >> (pixel * 2)) & 0x3;
    }

    private ppuDrawScanline(scanY: number, pal: number) {
        const lcdc = this.mmu.readReg(IORegister.LCDControl);
        const himapBg = (lcdc & 0x08) != 0;
        const himapWin = (lcdc & 0x40) != 0;
        let enableBg = (lcdc & 0x01) != 0;
        let enableWin = (lcdc & 0x20) != 0;
        let enableSprite = (lcdc & 0x02) != 0;
        const loTiles = (lcdc & 0x10) != 0;

        const scX = this.mmu.readReg(IORegister.ScrollX);
        const scY = this.mmu.readReg(IORegister.ScrollY);
        const winX = this.mmu.readReg(IORegister.WindowX);
        const winY = this.mmu.readReg(IORegister.WindowY);
        const objPal = [
            this.mmu.readReg(IORegister.ObjectPalette0),
            this.mmu.readReg(IORegister.ObjectPalette1)
        ];

        enableWin = enableWin && winX < 167 && winY < 144 && winY <= scanY;
        enableSprite = enableSprite && this.scanlineSprites.length > 0;
        if (!(enableWin || enableBg || enableSprite)) {
            return;
        }

        const tileRowY = (scanY + scY) & 0xFF;
        const tileIdxBaseAddr = 0x8000 + (himapBg ? 0x1C00 : 0x1800) + ((tileRowY >> 3) << 5);
        const curTileData = [0, 0];

        for (let x = 0; x < PPU.BUF_WIDTH; x++) {
            let bg = 0;
            if (enableWin && x + 7 >= winX) {
                bg = this.ppuPixel(himapWin, loTiles, x + 7 - winX, scanY - winY);
            }
            else if (enableBg) {
                const curTileALign = (x + scX) & 0xFF;
                if (!x || !(curTileALign & 0x7)) {
                    const tileX = curTileALign >> 3;
                    const tileIdx = this.mmu.read(tileIdxBaseAddr + tileX);
                    const addr = this.ppuTileLineAddress(tileIdx, tileRowY & 7, loTiles);
                    curTileData[0] = this.mmu.read(0x8000 + addr);
                    curTileData[1] = this.mmu.read(0x8000 + addr + 1);
                }

                bg = this.ppuLinePixel(curTileData, (x + scX) & 7);
            }

            let res = this.ppuPaletteResolve(bg, pal);

            if (enableSprite) {
                let matched = false;
                for (let i = 0; i < this.scanlineSprites.length; i++) {
                    const sp = this.scanlineSprites[i];
                    if (x + 8 < sp.x || x + 8 >= sp.x + 8) {
                        continue;
                    }

                    const tileX = x + 8 - sp.x;
                    const mirror = (sp.attr & 0x20) != 0;
                    const px = this.ppuLinePixel(sp.pixels, mirror ? (7 - tileX) : tileX);
                    if (px == 0) {
                        continue;
                    }

                    const priority = (sp.attr & 0x80) == 0;
                    if ((matched || bg > 0) && !priority) {
                        continue;
                    }

                    const palSP = objPal[(sp.attr & 0x10) != 0 ? 1 : 0];
                    res = this.ppuPaletteResolve(px, palSP);
                    matched = true;
                }
            }

            this.backbuffer[scanY * PPU.BUF_WIDTH + x] = res;
        }
    }

    ppuReadSprites(scanY: number) {
        const height = ((this.mmu.readReg(IORegister.LCDControl) & 0x04) != 0) ? 16 : 8;
        this.scanlineSprites.length = 0;
        for (let i = 0; i < 160; i += 4) {
            const y = this.mmu.read(MMUBase.OAMS + i);
            const x = this.mmu.read(MMUBase.OAMS + i + 1);
            if (x > 0 && y < 160 && x < 168 && scanY + 16 >= y && scanY + 16 < y + height) {
                let insPos = this.scanlineSprites.length;
                while (insPos > 0 && this.scanlineSprites[insPos - 1].x > x) {
                    if (insPos < 10) {
                        this.scanlineSprites[insPos] = this.scanlineSprites[insPos - 1];
                    }
                    --insPos;
                }

                if (insPos < 10) {
                    let tile = this.mmu.read(MMUBase.OAMS + i + 2);
                    const attr = this.mmu.read(MMUBase.OAMS + i + 3);

                    if (height == 16) {
                        tile &= 0xFE;
                    }

                    let tileY = scanY + 16 - y;
                    if ((attr & 0x40) != 0) {
                        tileY = (height - 1) - tileY;
                    }

                    const tileAddr = this.ppuTileLineAddress(tile, tileY, true);
                    const newSprite = {
                        x, attr,
                        pixels: [
                            this.mmu.read(0x8000 + tileAddr),
                            this.mmu.read(0x8000 + tileAddr + 1)
                        ]
                    };

                    if (insPos == this.scanlineSprites.length) {
                        this.scanlineSprites.push(newSprite);
                    }
                    else {
                        this.scanlineSprites[insPos] = newSprite;
                    }
                }
            }
        }
    }

    Step(cycles: number, render: boolean): void {
        const fbPalette = [0xFF, 0xAA, 0x85, 0];
        const regPalette = this.mmu.readReg(IORegister.BackgroundPalette);
        const lcdControl = this.mmu.readReg(IORegister.LCDControl);
        let lcdStat = this.mmu.readReg(IORegister.LCDStat);

        const mode = lcdStat & 0x3;
        const lcdEnabled = (lcdControl & 0x80)! + 0;
        if (!lcdEnabled) {
            this.state = PPUState.OAM;
            this.stateTicks = 0;
            lcdStat &= ~0x3;

            this.mmu.writeReg(IORegister.LCDStat, lcdStat);
            this.mmu.writeReg(IORegister.LCDY, 0);
            return;
        }

        if (this.mmu.readReg(IORegister.LCDY) ===
            this.mmu.readReg(IORegister.LCDYCompare)) {
            if ((lcdStat & 0x4) == 0) {
                lcdStat |= 0x4;
                this.mmu.writeReg(IORegister.LCDStat, lcdStat);
                if ((lcdStat & 0x40) != 0) {
                    this.mmu.writeReg(IORegister.InterruptFlag, this.mmu.readReg(IORegister.InterruptFlag) | IOInterrupt.LCDC);
                }
            }
        }
        else if ((lcdStat & 0x4) != 0) {
            lcdStat &= ~0x4;
            this.mmu.writeReg(IORegister.LCDStat, lcdStat);
        }

        this.stateTicks += cycles;
        while (this.stateTicks > 0) {
            switch (this.state) {
                case PPUState.OAM:
                    if ((lcdStat & 0x3) != 2) {
                        lcdStat = (lcdStat & ~0x3) | 2;
                        this.mmu.writeReg(IORegister.LCDStat, lcdStat);
                        if ((lcdStat & 0x20) != 0) {
                            this.mmu.writeReg(IORegister.InterruptFlag, this.mmu.readReg(IORegister.InterruptFlag) | IOInterrupt.LCDC);
                        }
                    }

                    if (this.stateTicks >= 20) {
                        const lineY = this.mmu.readReg(IORegister.LCDY);
                        this.ppuReadSprites(lineY);
                        this.state = PPUState.PixelTransfer;
                        break;
                    }
                    else {
                        return;
                    }

                case PPUState.PixelTransfer:
                    if ((lcdStat & 0x3) != 3) {
                        lcdStat = (lcdStat & ~0x3) | 3;
                        this.mmu.writeReg(IORegister.LCDStat, lcdStat);
                    }

                    if (this.stateTicks >= 63) {
                        if (render) {
                            const lineY = this.mmu.readReg(IORegister.LCDY);
                            this.ppuDrawScanline(lineY, regPalette);
                        }

                        this.state = PPUState.HBlank;
                        break;
                    }
                    else {
                        return;
                    }

                case PPUState.HBlank:
                    if ((lcdStat & 0x3) != 0) {
                        lcdStat = (lcdStat & ~0x3) | 0;
                        this.mmu.writeReg(IORegister.LCDStat, lcdStat);
                        if ((lcdStat & 0x80) != 0) {
                            this.mmu.writeReg(IORegister.InterruptFlag, this.mmu.readReg(IORegister.InterruptFlag) | IOInterrupt.LCDC);
                        }
                    }

                    if (this.stateTicks >= 114) {
                        this.stateTicks -= 114;
                        const lineY = this.mmu.readReg(IORegister.LCDY) + 1;
                        this.state = lineY < PPU.BUF_HEIGHT ? PPUState.OAM : PPUState.VBlank;
                        this.mmu.writeReg(IORegister.LCDY, lineY);
                        break;
                    }
                    else {
                        return;
                    }

                case PPUState.VBlank:
                    if ((lcdStat & 0x3) != 1) {
                        lcdStat = (lcdStat & ~0x3) | 1;
                        this.mmu.writeReg(IORegister.LCDStat, lcdStat);
                        this.mmu.writeReg(IORegister.InterruptFlag, this.mmu.readReg(IORegister.InterruptFlag) | IOInterrupt.VBlank);

                        if (render) {
                            for (let y = 0; y < PPU.BUF_HEIGHT; y++) {
                                let src = y * PPU.BUF_WIDTH;
                                let dst = y * PPU.BUF_WIDTH;
                                // let dst = (PPU.BUF_HEIGHT - y - 1) * PPU.BUF_WIDTH;

                                for (let x = 0; x < PPU.BUF_WIDTH; x++) {
                                    this.framebuffer[dst++] = fbPalette[this.backbuffer[src++] & 0x3];
                                }
                            }
                        }
                    }

                    if (this.stateTicks >= 114) {
                        this.stateTicks -= 114;
                        let lineY = this.mmu.readReg(IORegister.LCDY) + 1;
                        if (lineY === 154) {
                            lineY = 0;
                            this.state = PPUState.OAM;
                        }

                        this.mmu.writeReg(IORegister.LCDY, lineY);
                        break;
                    }
                    else {
                        return;
                    }
            }
        }
    }
}
