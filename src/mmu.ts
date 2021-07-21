class MemoryRange {

}

interface MemoryRegion {
    start: number;
    length: number;

    read(addr: number): number;
    write(addr: number, v: number): void;
}

export const enum MMUBase {
    Boot = 0x0000,
    ROM0 = 0x0000,
    ROMB = 0x4000,
    VRAM = 0x8000,
    RAMB = 0xA000,
    RAMW = 0xC000,
    RAMM = 0xE000,
    OAMS = 0xFE00,
    REGS = 0xFF00,
    RAMH = 0xFF80,
}

export const enum IORegister {
	Joypad = 0x00,
	SerialData = 0x01,
	SerialControl = 0x02,
	Divider = 0x04,
	TimerCounter = 0x05,
	TimerModulo = 0x06,
	TimerControl = 0x07,
	InterruptFlag = 0x0F,

	Sound1Sweep = 0x10,
	Sound1Mode = 0x11,
	Sound1Envelope = 0x12,
	Sound1FreqLo = 0x13,
	Sound1FreqHi = 0x14,

	Sound2Mode = 0x16,
	Sound2Envelope = 0x17,
	Sound2FreqLo = 0x18,
	Sound2FreqHi = 0x19,

	Sound3Enable = 0x1A,
	Sound3Length = 0x1B,
	Sound3Level = 0x1C,
	Sound3FreqLo = 0x1D,
	Sound3FreqHi = 0x1E,

	Sound4Length = 0x20,
	Sound4Envelope = 0x21,
	Sound4Poly = 0x22,
	Sound4Counter = 0x23,

	SoundChannels = 0x24,
	SoundOutput = 0x25,
	SoundControl = 0x26,

	LCDControl = 0x40,
	LCDStat = 0x41,
	ScrollY = 0x42,
	ScrollX = 0x43,
	LCDY = 0x44,
	LCDYCompare = 0x45,
	OAMDMA = 0x46,
	BackgroundPalette = 0x47,
	ObjectPalette0 = 0x48,
	ObjectPalette1 = 0x49,
	WindowY = 0x4A,
	WindowX = 0x4B,

	BootROMDisable = 0x50,
};

export default class MMU {
    private mem: Uint8Array;
    private rom: Uint8Array;

    // private mbc1RamEnable: boolean;
    // private mbc2RamEnable: boolean;
    private mbc1RomBank: number;
    private mbc2RomBank: number;
    // private mbc1RamBank: number;
    private mbc1RomMode: number;
    private mbc: number;

    constructor(rom: Uint8Array) {
        this.rom = rom;
        this.mem = new Uint8Array(0x10000);

        // this.mbc1RamEnable = this.mbc2RamEnable = false;
        // this.mbc1RamBank = 0;
        this.mbc1RomMode = 0;
        this.mbc1RomBank = this.mbc2RomBank = 1;

        this.mbc = 0;
        switch (rom[0x147]) {
            case 0:
                this.mbc = 0; break;

            case 0x1: case 0x2: case 0x3:
                this.mbc = 1; break;

            case 0xF: case 0x10: case 0x11: case 0x12: case 0x13:
                this.mbc = 3; break;

            default:
                console.log('Unhandled rom type', rom[0x147]);
        }

        for (let i = 0; i < 0x8000; i++) {
            this.mem[i] = rom[i];
        }
    }

    read(addr: number): number {
        if (addr >= 0x4000 && addr < 0x8000) {
            switch (this.mbc) {
                case 1: case 3:
                    if (this.mbc1RomBank) {
                        return this.rom[(this.mbc1RomBank << 14) + (addr & 0x3FFF)];
                    }
                    break;

                case 2:
                    if (this.mbc2RomBank) {
                        return this.rom[(this.mbc2RomBank << 14) + (addr & 0x3FFF)];
                    }
                    break;
            }
        }

        return this.mem[addr];
    }

    write(addr: number, v: number): void {
        v &= 0xFF;

        if (addr >= 0xFF00) {
            if (addr == 0xFF46) {
                const dmaAddr = v << 8;
                for (let i = 0; i < 0xA0; i++) {
                    this.mem[0xFE00 + i] = this.mem[dmaAddr + i];
                }
                return;
            }
        }

        switch (this.mbc) {
            case 1: case 3:
                if (addr < 0x2000) {
                    // this.mbc1RamEnable = v > 0;
                }
                else if (addr < 0x4000) {
                    this.mbc1RomBank = v & 0x1F;
                    if (v == 0x00 || v == 0x20 || v == 0x40 || v == 0x60) {
                        ++this.mbc1RomBank;
                    }
                }
                else if (addr < 0x6000) {
                    if (this.mbc1RomMode == 0) {
                        this.mbc1RomBank |= (v & 3) << 5;
                    }
                    else {
                        this.mbc1RomBank = v & 3;
                    }
                }
                else if (addr < 0x8000) {
                    this.mbc1RomMode = v > 0 ? 1 : 0;
                }
                else {
                    this.mem[addr] = v;
                }
                break;

            case 2:
                if (addr < 0x2000) {
                    // this.mbc2RamEnable = v > 0;
                }
                else if (addr < 0x4000) {
                    this.mbc2RomBank = v & 0x1F;
                    if (v == 0x00 || v == 0x20 || v == 0x40 || v == 0x60) {
                        ++this.mbc2RomBank;
                    }
                }
                else if (addr >= 0x8000) {
                    this.mem[addr] = v;
                }
                break;

            case 0:
            default:
                if (addr >= 0x8000) {
                    this.mem[addr] = v;
                }
                break;
        }
    }

    readReg(reg: IORegister): number {
        return this.read(MMUBase.REGS + reg);
    }

    writeReg(reg: IORegister, v: number) {
        this.write(MMUBase.REGS | reg, v);
    }
}
