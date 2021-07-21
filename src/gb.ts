import { rawListeners } from 'process';
import MMU, { IORegister, MMUBase } from './mmu';
import './ppu';

export class Register {
	private lo: number;
	private hi: number;

	constructor() {
		this.lo = 0;
		this.hi = 0;
	}

	public setLo(lo: number): Register { this.lo = lo & 0xFF; return this; }
	public setHi(hi: number): Register { this.hi = hi & 0xFF; return this; }

	public setWord(w: number) {
		this.hi = w & 0xFF;
		this.lo = (w >> 8) & 0xFF;
		return this;
	}

	public Lo(): number { return this.lo; }
	public Hi(): number { return this.hi; }
	public Word(): number { return (this.lo << 8) + this.hi; }
}

export const enum ArithFlag {
	C = 0x10,
	H = 0x20,
	N = 0x40,
	Z = 0x80
}

export const enum IOInterrupt {
	VBlank = 0x01,
	LCDC = 0x02,
	TIMA = 0x04,
	Serial = 0x08,
	Joypad = 0x10,

	Mask = 0x1F,

	Stat_Enabled = 0x01,
	Stat_Pending = 0x02
};

export const enum Button {
	Down = 0x80,
	Up = 0x40,
	Left = 0x20,
	Right = 0x10,

	Start = 0x08,
	Select = 0x04,
	B = 0x02,
	A = 0x01
};

export class GBTimer {
	private mmu: MMU;
	private timerClock: number;
	private divClock: number;

	constructor(mmu: MMU) {
		this.mmu = mmu;
		this.timerClock = 0;
		this.divClock = 0;
	}

	Step(cycles: number): void {
		this.divClock += cycles;
		if (this.divClock & ~0x3F) {
			this.mmu.writeReg(IORegister.Divider, this.mmu.readReg(IORegister.Divider) + (this.divClock >> 6));
			this.divClock &= 0x3F;
		}

		const timerFlag = this.mmu.readReg(IORegister.TimerControl);
		if ((timerFlag & 0x04) == 0) {
			return;
		}

		this.timerClock += cycles;

		let freq: number;
		switch (timerFlag & 0x3) {
			case 0: freq = 12; break;
			case 1: freq = 18; break;
			case 2: freq = 16; break;
			default: freq = 14;
		}

		const shift = 20 - freq;
		if ((this.timerClock >> shift) > 0) {
			const step = 1 << shift;
			do {
				this.mmu.writeReg(IORegister.TimerCounter, this.mmu.readReg(IORegister.TimerCounter) + 1);
				if (this.mmu.readReg(IORegister.TimerCounter) == 0) {
					this.mmu.writeReg(IORegister.InterruptFlag, this.mmu.readReg(IORegister.InterruptFlag) | IOInterrupt.TIMA);
					this.mmu.writeReg(IORegister.TimerCounter, this.mmu.readReg(IORegister.TimerModulo));
				}

				this.timerClock -= step;
			}
			while ((this.timerClock >> shift) > 0);
		}
	}
}

export default class GB {
	private static INSTR_CYCLES: number[] = [
		1, 3, 2, 2, 1, 1, 2, 1, 5, 2, 2, 2, 1, 1, 2, 1,
		0, 3, 2, 2, 1, 1, 2, 1, 3, 2, 2, 2, 1, 1, 2, 1,
		2, 3, 2, 2, 1, 1, 2, 1, 2, 2, 2, 2, 1, 1, 2, 1,
		2, 3, 2, 2, 3, 3, 3, 1, 2, 2, 2, 2, 1, 1, 2, 1,
		1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1,
		1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1,
		1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1,
		2, 2, 2, 2, 2, 2, 0, 2, 1, 1, 1, 1, 1, 1, 2, 1,
		1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1,
		1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1,
		1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1,
		1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1,
		2, 3, 3, 4, 3, 4, 2, 4, 2, 4, 3, 0, 3, 6, 2, 4,
		2, 3, 3, 0, 3, 4, 2, 4, 2, 4, 3, 0, 3, 0, 2, 4,
		3, 3, 2, 0, 0, 4, 2, 4, 4, 1, 4, 0, 0, 0, 2, 4,
		3, 3, 2, 1, 0, 4, 2, 4, 3, 2, 4, 1, 0, 0, 2, 4
	];

	private static INSTR_CYCLES_CB: number[] = [
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 3, 2,
		2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 3, 2,
		2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 3, 2,
		2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 3, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2,
		2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4, 2
	];

	private af: Register;
	private bc: Register;
	private de: Register;
	private hl: Register;

	private sp: number;
	private pc: number;

	private mmu: MMU;

	private intStat: number;
	private halt: boolean;
	private haltBug: boolean;
	private buttons: number;

	getPC(): number { return this.pc; }
	getSP(): number { return this.sp; }
	getAF(): Register { return this.af; }
	getBC(): Register { return this.bc; }
	getDE(): Register { return this.de; }
	getHL(): Register { return this.hl; }

	constructor(mmu: MMU) {
		this.mmu = mmu;

		this.af = new Register();
		this.bc = new Register();
		this.de = new Register();
		this.hl = new Register();

		this.af.setWord(0x01B0);
		this.bc.setWord(0x0013);
		this.de.setWord(0x00D8);
		this.hl.setWord(0x014D);

		this.pc = 0x100;
		this.sp = 0xFFFE;

		this.intStat = 0;
		this.halt = false;
		this.haltBug = false;
		this.buttons = 0;

		mmu.writeReg(IORegister.Joypad, 0xCF);
		mmu.writeReg(IORegister.SerialControl, 0x7E);
		mmu.writeReg(IORegister.TimerCounter, 0x00);
		mmu.writeReg(IORegister.TimerModulo, 0x00);
		mmu.writeReg(IORegister.TimerControl, 0x00);
		mmu.write(0xFF10, 0x80);
		mmu.write(0xFF11, 0xBF);
		mmu.write(0xFF12, 0xF3);
		mmu.write(0xFF14, 0xBF);
		mmu.write(0xFF16, 0x3F);
		mmu.write(0xFF17, 0x00);
		mmu.write(0xFF19, 0xBF);
		mmu.write(0xFF1A, 0x7F);
		mmu.write(0xFF1B, 0xFF);
		mmu.write(0xFF1C, 0x9F);
		mmu.write(0xFF1E, 0xBF);
		mmu.write(0xFF20, 0xFF);
		mmu.write(0xFF21, 0x00);
		mmu.write(0xFF22, 0x00);
		mmu.write(0xFF23, 0xBF);
		mmu.write(0xFF24, 0x77);
		mmu.write(0xFF25, 0xF3);
		mmu.write(0xFF26, 0xF1);
		mmu.writeReg(IORegister.LCDControl, 0x91);
		mmu.writeReg(IORegister.LCDStat, 0x00);
		mmu.writeReg(IORegister.ScrollY, 0x00);
		mmu.writeReg(IORegister.ScrollX, 0x00);
		mmu.writeReg(IORegister.LCDY, 0x00);
		mmu.writeReg(IORegister.LCDYCompare, 0x00);
		mmu.writeReg(IORegister.BackgroundPalette, 0xFC);
		mmu.writeReg(IORegister.ObjectPalette0, 0xFF);
		mmu.writeReg(IORegister.ObjectPalette1, 0xFF);
		mmu.writeReg(IORegister.WindowY, 0x00);
		mmu.writeReg(IORegister.WindowX, 0x00);
		mmu.writeReg(IORegister.BootROMDisable, 1);
		mmu.write(0xFFFF, 0x00);
	}

	static toUnsigned8(v: number): number {
		v &= 0xFF;
		if (v > 127) {
			return v - 0x100;
		}
		else {
			return v;
		}
	}

	private imm8 = () => this.mmu.read(this.pc++);
	private ld16 = () => new Register().setHi(this.imm8()).setLo(this.imm8());
	private imm16 = () => this.ld16().Word();

	private aflagSet = (flag: ArithFlag) => this.af.setHi(this.af.Hi() | flag);
	private aflagClear = (flag: ArithFlag) => this.af.setHi(this.af.Hi() & ~flag);
	private aflagCond = (flag: ArithFlag, cond: boolean) => cond ? this.aflagSet(flag) : this.aflagClear(flag);
	private aflagIsSet = (flag: ArithFlag) => (this.af.Hi() & flag) != 0;

	private push16(reg: Register) {
		this.mmu.write(--this.sp, reg.Lo()); this.sp &= 0xFFFF;
		this.mmu.write(--this.sp, reg.Hi()); this.sp &= 0xFFFF;
	}

	private pop16(): Register {
		const reg = new Register();
		reg.setHi(this.mmu.read(this.sp++)); this.sp &= 0xFFFF;
		reg.setLo(this.mmu.read(this.sp++)); this.sp &= 0xFFFF;
		return reg;
	}

	private add8 = (v0: number, v1: number, carry: boolean) => {
		const sum = v0 + v1 + (carry ? 1 : 0);
		const hsum = (v0 & 0xF) + (v1 & 0xF) + (carry ? 1 : 0);

		this.aflagCond(ArithFlag.Z, (sum & 0xFF) == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagCond(ArithFlag.H, hsum > 0xF);
		this.aflagCond(ArithFlag.C, sum > 0xFF);

		return sum & 0xFF;
	}

	private add16 = (v0: number, v1: number) => {
		const sum = v0 + v1;
		const hsum = (v0 & 0xFFF) + (v1 & 0xFFF);

		this.aflagClear(ArithFlag.N);
		this.aflagCond(ArithFlag.H, hsum > 0xFFF);
		this.aflagCond(ArithFlag.C, sum > 0xFFFF);

		return sum & 0xFFFF;
	}

	private sub8 = (v0: number, v1: number, carry: boolean) => {
		const sum = (v0 - v1 - (carry ? 1 : 0)) & 0xFFFF;
		const hsum = ((v0 & 0xF) - (v1 & 0xF) - (carry ? 1 : 0)) & 0xFFFF;

		this.aflagCond(ArithFlag.Z, (sum & 0xFF) == 0);
		this.aflagSet(ArithFlag.N)
		this.aflagCond(ArithFlag.H, hsum > 0xF);
		this.aflagCond(ArithFlag.C, sum > 0xFF);

		return sum & 0xFF;
	}

	private incr8(r: number) {
		this.aflagCond(ArithFlag.Z, r == 0xFF);
		this.aflagClear(ArithFlag.N);
		this.aflagCond(ArithFlag.H, (r & 0xF) == 0xF);
		return r + 1;
	}

	private decr8(r: number) {
		this.aflagCond(ArithFlag.Z, r == 0x01);
		this.aflagSet(ArithFlag.N)
		this.aflagCond(ArithFlag.H, !(r & 0xF));
		return r - 1;
	}

	private and(v: number) {
		this.af.setLo(this.af.Lo() & v);
		this.aflagCond(ArithFlag.Z, this.af.Lo() == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagSet(ArithFlag.H)
		this.aflagClear(ArithFlag.C);
	}

	private or(v: number) {
		this.af.setLo(this.af.Lo() | v);
		this.aflagCond(ArithFlag.Z, this.af.Lo() == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagClear(ArithFlag.C);
	}

	private xor(v: number) {
		this.af.setLo(this.af.Lo() ^ v);
		this.aflagCond(ArithFlag.Z, this.af.Lo() == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagClear(ArithFlag.C);
	}

	private bitRLC(v: number) {
		this.aflagCond(ArithFlag.Z, v == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagCond(ArithFlag.C, (v & 0x80) != 0);

		return ((v << 1) | (v >> 7)) & 0xFF;
	}

	private bitRRC(v: number) {
		this.aflagCond(ArithFlag.Z, v == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagCond(ArithFlag.C, (v & 0x01) != 0);

		return ((v >> 1) | (v << 7)) & 0xFF;
	}

	private bitRL(v: number) {
		const carry = this.aflagIsSet(ArithFlag.C) ? 1 : 0;

		this.aflagCond(ArithFlag.Z, (((v << 1) + carry) & 0xFF) == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagCond(ArithFlag.C, (v & 0x80) != 0);

		return ((v << 1) + carry) & 0xFF;
	}

	private bitRR(v: number) {
		const carry = this.aflagIsSet(ArithFlag.C) ? 0x80 : 0;

		this.aflagCond(ArithFlag.Z, ((v >> 1) + carry) == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagCond(ArithFlag.C, (v & 0x01) != 0);

		return (v >> 1) + carry;
	}

	private bitCPL(v: number) {
		this.aflagSet(ArithFlag.N)
		this.aflagSet(ArithFlag.H)

		return v ^ 0xFF;
	}

	private bitSL(v: number) {
		this.aflagCond(ArithFlag.Z, ((v << 1) & 0xFF) == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagCond(ArithFlag.C, (v & 0x80) != 0);

		return (v << 1) & 0xFF;
	}

	private bitSR(v: number) {
		this.aflagCond(ArithFlag.Z, (((v >> 1) | (v & 0x80)) & 0xFF) == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagCond(ArithFlag.C, (v & 0x01) != 0);

		return ((v >> 1) | (v & 0x80)) & 0xFF;
	}

	private bitSRL(v: number) {
		this.aflagCond(ArithFlag.Z, ((v >> 1) & 0xFF) == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagCond(ArithFlag.C, (v & 0x01) != 0);

		return (v >> 1) & 0xFF;
	}

	private bitSwap(v: number) {
		v = ((v >> 4) | (v << 4)) & 0xFF;

		this.aflagCond(ArithFlag.Z, v == 0);
		this.aflagClear(ArithFlag.N);
		this.aflagClear(ArithFlag.H);
		this.aflagClear(ArithFlag.C);

		return v;
	}

	private jmpAbs = (addr: number) => this.pc = addr;
	private jmpRel = (offs: number) => this.pc += GB.toUnsigned8(offs);

	private jmpRet() {
		this.pc = this.pop16().Word();
	}

	private jmpCall(addr: number) {
		this.push16(new Register().setWord(this.pc));
		this.pc = addr;
	}

	private jmpAbsCond(addr: number, cond: boolean) {
		if (cond) {
			this.jmpAbs(addr);
			return 1;
		}
		else {
			return 0;
		}
	}

	private jmpRelCond(offs: number, cond: boolean) {
		if (cond) {
			this.jmpRel(offs);
			return 1;
		}
		else {
			return 0;
		}
	}

	private jmpCallCond(addr: number, cond: boolean) {
		if (cond) {
			this.jmpCall(addr);
			return 3;
		}
		else {
			return 0;
		}
	}

	private jmpRetCond(cond: boolean) {
		if (cond) {
			this.jmpRet();
			return 3;
		}
		else {
			return 0;
		}
	}

	private readRegN(n: number) {
		switch (n) {
			case 0: return this.bc.Lo();
			case 1: return this.bc.Hi();
			case 2: return this.de.Lo();
			case 3: return this.de.Hi();
			case 4: return this.hl.Lo();
			case 5: return this.hl.Hi();
			case 6: return this.mmu.read(this.hl.Word());
			case 7: return this.af.Lo();
		}
		return 0xFF;
	}

	private writeRegN(n: number, v: number) {
		switch (n) {
			case 0: this.bc.setLo(v); return;
			case 1: this.bc.setHi(v); return;
			case 2: this.de.setLo(v); return;
			case 3: this.de.setHi(v); return;
			case 4: this.hl.setLo(v); return;
			case 5: this.hl.setHi(v); return;
			case 6: this.mmu.write(this.hl.Word(), v); return;
			case 7: this.af.setLo(v); return;
		}
	}

	private procCB(opcode: number) {
		const op = opcode >> 6;
		const bit = (opcode >> 3) & 7;
		const reg = opcode & 7;

		let v = this.readRegN(reg);
		switch (op) {
			case 0x0:
				switch (bit) {
					case 0x0: v = this.bitRLC(v); break;
					case 0x1: v = this.bitRRC(v); break;
					case 0x2: v = this.bitRL(v); break;
					case 0x3: v = this.bitRR(v); break;

					case 0x4: v = this.bitSL(v); break;
					case 0x5: v = this.bitSR(v); break;
					case 0x6: v = this.bitSwap(v); break;
					case 0x7: v = this.bitSRL(v); break;
				}

				this.writeRegN(reg, v);
				break;

			case 0x1:
				this.aflagCond(ArithFlag.Z, (v & (1 << bit)) == 0);
				this.aflagClear(ArithFlag.N);
				this.aflagSet(ArithFlag.H)
				break;

			case 0x2:
				v &= ~(1 << bit);
				this.writeRegN(reg, v);
				break;

			case 0x3:
				v |= 1 << bit;
				this.writeRegN(reg, v);
				break;
		}
	}

	ButtonOn(btn: Button) { this.buttons |= btn; }
	ButtonOff(btn: Button) { this.buttons &= ~btn; }

	Step(): number {
		let addCycles = 0;
		const invButtons = this.buttons ^ 0xFF;
		const regJoystick = this.mmu.readReg(IORegister.Joypad);
		if (regJoystick & 0x20) {
			this.mmu.writeReg(IORegister.Joypad, (regJoystick & 0xF0) | ((invButtons >> 4) & 0x0F));
		}
		else if (regJoystick & 0x10) {
			this.mmu.writeReg(IORegister.Joypad, (regJoystick & 0xF0) | (invButtons & 0x0F));
		}
		else if (regJoystick == 0x03) {
			this.mmu.writeReg(IORegister.Joypad, 0xFF);
		}

		const intFlag = this.mmu.readReg(IORegister.InterruptFlag);
		const irq = intFlag & IOInterrupt.Mask & this.mmu.read(0xFFFF);
		if (irq != 0) {
			if (this.halt) {
				this.halt = false;
			}

			if ((this.intStat & IOInterrupt.Stat_Enabled) != 0) {
				for (let i = 0; i < 5; i++) {
					if ((irq & (1 << i)) != 0) {
						this.intStat &= ~IOInterrupt.Stat_Enabled;
						addCycles += 2;
						this.jmpCall(0x40 + (i << 3));
						this.mmu.writeReg(IORegister.InterruptFlag, intFlag & ~(1 << i));
						break;
					}
				}
			}
		}

		if (this.halt) {
			++addCycles;
			return addCycles;
		}

		if ((this.intStat & IOInterrupt.Stat_Pending) != 0) {
			this.intStat |= IOInterrupt.Stat_Enabled;
			this.intStat &= ~IOInterrupt.Stat_Pending
		}

		const pc0 = this.pc;
		const opcode1: number = this.imm8();

		if (this.haltBug) {
			this.haltBug = false;
			--this.pc;
		}

		const opcode2: number = opcode1 == 0xCB ? this.imm8() : 0;
		const opcode = opcode1 == 0xCB ? opcode2 : opcode1;
		const carry = this.aflagIsSet(ArithFlag.C);

		switch (opcode1) {
			case 0x0: break;
			case 0x10: break;

			case 0x01: this.bc = this.ld16(); break;
			case 0x11: this.de = this.ld16(); break;
			case 0x21: this.hl = this.ld16(); break;
			case 0x31: this.sp = this.ld16().Word(); break;

			case 0x02: this.mmu.write(this.bc.Word(), this.af.Lo()); break;
			case 0x12: this.mmu.write(this.de.Word(), this.af.Lo()); break;
			case 0x22: this.mmu.write(this.hl.Word(), this.af.Lo()); this.hl.setWord(this.hl.Word() + 1); break;
			case 0x32: this.mmu.write(this.hl.Word(), this.af.Lo()); this.hl.setWord(this.hl.Word() - 1); break;

			case 0x03: this.bc.setWord(this.bc.Word() + 1); break;
			case 0x13: this.de.setWord(this.de.Word() + 1); break;
			case 0x23: this.hl.setWord(this.hl.Word() + 1); break;
			case 0x33: ++this.sp; this.sp &= 0xFFFF; break;

			case 0x04: this.bc.setLo(this.incr8(this.bc.Lo())); break;
			case 0x14: this.de.setLo(this.incr8(this.de.Lo())); break;
			case 0x24: this.hl.setLo(this.incr8(this.hl.Lo())); break;
			case 0x34: {
				const v = this.incr8(this.mmu.read(this.hl.Word()));
				this.mmu.write(this.hl.Word(), v);
				break;
			}

			case 0x05: this.bc.setLo(this.decr8(this.bc.Lo())); break;
			case 0x15: this.de.setLo(this.decr8(this.de.Lo())); break;
			case 0x25: this.hl.setLo(this.decr8(this.hl.Lo())); break;
			case 0x35: {
				const v = this.decr8(this.mmu.read(this.hl.Word()));
				this.mmu.write(this.hl.Word(), v);
				break;
			}

			case 0x06: this.bc.setLo(this.imm8()); break;
			case 0x16: this.de.setLo(this.imm8()); break;
			case 0x26: this.hl.setLo(this.imm8()); break;
			case 0x36: this.mmu.write(this.hl.Word(), this.imm8()); break;

			case 0x07: this.aflagClear(ArithFlag.Z); this.aflagClear(ArithFlag.H); this.aflagClear(ArithFlag.N);
				this.aflagCond(ArithFlag.C, (this.af.Lo() & 0x80) != 0); this.af.setLo((this.af.Lo() << 1) | (this.af.Lo() >> 7)); break;

			case 0x0F: this.aflagClear(ArithFlag.Z); this.aflagClear(ArithFlag.H); this.aflagClear(ArithFlag.N);
				this.aflagCond(ArithFlag.C, (this.af.Lo() & 0x01) != 0); this.af.setLo((this.af.Lo() >> 1) | (this.af.Lo() << 7)); break;

			case 0x17: this.aflagClear(ArithFlag.Z); this.aflagClear(ArithFlag.H); this.aflagClear(ArithFlag.N);
				this.aflagCond(ArithFlag.C, (this.af.Lo() & 0x80) != 0); this.af.setLo((this.af.Lo() << 1) | (carry ? 1 : 0)); break;

			case 0x1F: this.aflagClear(ArithFlag.Z); this.aflagClear(ArithFlag.H); this.aflagClear(ArithFlag.N);
				this.aflagCond(ArithFlag.C, (this.af.Lo() & 0x01) != 0); this.af.setLo((this.af.Lo() >> 1) | (carry ? 0x80 : 0)); break;

			case 0x2F: this.af.setLo(this.bitCPL(this.af.Lo())); break;

			case 0x27: {
				let a = this.af.Lo();
				if (this.aflagIsSet(ArithFlag.N)) {
					if (this.aflagIsSet(ArithFlag.H)) {
						a -= 0x06;
						a &= 0xFF;
					}

					if (this.aflagIsSet(ArithFlag.C)) {
						a -= 0x60;
					}
				}
				else {
					if ((a & 0x0F) > 0x09 || this.aflagIsSet(ArithFlag.H)) {
						a += 0x06;
					}

					if (a > 0x9F || this.aflagIsSet(ArithFlag.C)) {
						a += 0x60;
					}
				}
				this.aflagCond(ArithFlag.Z, (a & 0xFF) == 0);
				this.aflagClear(ArithFlag.H);
				if (a & 0x100) {
					this.aflagSet(ArithFlag.C)
				}
				this.af.setLo(a & 0xFF);
				break;
			}

			case 0x37: this.aflagClear(ArithFlag.N); this.aflagClear(ArithFlag.H); this.aflagSet(ArithFlag.C); break;
			case 0x3F: this.aflagClear(ArithFlag.N); this.aflagClear(ArithFlag.H); this.aflagCond(ArithFlag.C, !this.aflagIsSet(ArithFlag.C)); break;

			case 0x08: {
				let addr = this.imm16();
				this.mmu.write(addr++, this.sp & 0xFF);
				this.mmu.write(addr++, (this.sp & 0xFF00) >> 8);
				break;
			}

			case 0xE8: {
				const w = (this.sp + GB.toUnsigned8(this.imm8())) & 0xFFFF;
				this.aflagClear(ArithFlag.Z);
				this.aflagClear(ArithFlag.N);
				this.aflagCond(ArithFlag.H, (w & 0xF) < (this.sp & 0xF));
				this.aflagCond(ArithFlag.C, (w & 0xFF) < (this.sp & 0xFF));
				this.sp = w;
				break;
			}

			case 0xF8: {
				const w = (this.sp + GB.toUnsigned8(this.imm8())) & 0xFFFF;
				this.aflagClear(ArithFlag.Z);
				this.aflagClear(ArithFlag.N);
				this.aflagCond(ArithFlag.H, (w & 0xF) < (this.sp & 0xF));
				this.aflagCond(ArithFlag.C, (w & 0xFF) < (this.sp & 0xFF));
				this.hl.setWord(w);
				break;
			}

			case 0x09: this.hl.setWord(this.add16(this.hl.Word(), this.bc.Word())); break;
			case 0x19: this.hl.setWord(this.add16(this.hl.Word(), this.de.Word())); break;
			case 0x29: this.hl.setWord(this.add16(this.hl.Word(), this.hl.Word())); break;
			case 0x39: this.hl.setWord(this.add16(this.hl.Word(), this.sp)); break;

			case 0xF9: this.sp = this.hl.Word(); break;

			case 0x0B: this.bc.setWord(this.bc.Word() - 1); break;
			case 0x1B: this.de.setWord(this.de.Word() - 1); break;
			case 0x2B: this.hl.setWord(this.hl.Word() - 1); break;
			case 0x3B: --this.sp; this.sp &= 0xFFFF; break;

			case 0x0A: this.af.setLo(this.mmu.read(this.bc.Word())); break;
			case 0x1A: this.af.setLo(this.mmu.read(this.de.Word())); break;
			case 0x2A: this.af.setLo(this.mmu.read(this.hl.Word())); this.hl.setWord(this.hl.Word() + 1); break;
			case 0x3A: this.af.setLo(this.mmu.read(this.hl.Word())); this.hl.setWord(this.hl.Word() - 1); break;

			case 0x0C: this.bc.setHi(this.incr8(this.bc.Hi())); break;
			case 0x1C: this.de.setHi(this.incr8(this.de.Hi())); break;
			case 0x2C: this.hl.setHi(this.incr8(this.hl.Hi())); break;
			case 0x3C: this.af.setLo(this.incr8(this.af.Lo())); break;

			case 0x0D: this.bc.setHi(this.decr8(this.bc.Hi())); break;
			case 0x1D: this.de.setHi(this.decr8(this.de.Hi())); break;
			case 0x2D: this.hl.setHi(this.decr8(this.hl.Hi())); break;
			case 0x3D: this.af.setLo(this.decr8(this.af.Lo())); break;

			case 0x0E: this.bc.setHi(this.imm8()); break;
			case 0x1E: this.de.setHi(this.imm8()); break;
			case 0x2E: this.hl.setHi(this.imm8()); break;
			case 0x3E: this.af.setLo(this.imm8()); break;

			case 0x40: this.bc.setLo(this.bc.Lo()); break;
			case 0x41: this.bc.setLo(this.bc.Hi()); break;
			case 0x42: this.bc.setLo(this.de.Lo()); break;
			case 0x43: this.bc.setLo(this.de.Hi()); break;
			case 0x44: this.bc.setLo(this.hl.Lo()); break;
			case 0x45: this.bc.setLo(this.hl.Hi()); break;
			case 0x46: this.bc.setLo(this.mmu.read(this.hl.Word())); break;
			case 0x47: this.bc.setLo(this.af.Lo()); break;

			case 0x48: this.bc.setHi(this.bc.Lo()); break;
			case 0x49: this.bc.setHi(this.bc.Hi()); break;
			case 0x4A: this.bc.setHi(this.de.Lo()); break;
			case 0x4B: this.bc.setHi(this.de.Hi()); break;
			case 0x4C: this.bc.setHi(this.hl.Lo()); break;
			case 0x4D: this.bc.setHi(this.hl.Hi()); break;
			case 0x4E: this.bc.setHi(this.mmu.read(this.hl.Word())); break;
			case 0x4F: this.bc.setHi(this.af.Lo()); break;

			case 0x50: this.de.setLo(this.bc.Lo()); break;
			case 0x51: this.de.setLo(this.bc.Hi()); break;
			case 0x52: this.de.setLo(this.de.Lo()); break;
			case 0x53: this.de.setLo(this.de.Hi()); break;
			case 0x54: this.de.setLo(this.hl.Lo()); break;
			case 0x55: this.de.setLo(this.hl.Hi()); break;
			case 0x56: this.de.setLo(this.mmu.read(this.hl.Word())); break;
			case 0x57: this.de.setLo(this.af.Lo()); break;

			case 0x58: this.de.setHi(this.bc.Lo()); break;
			case 0x59: this.de.setHi(this.bc.Hi()); break;
			case 0x5A: this.de.setHi(this.de.Lo()); break;
			case 0x5B: this.de.setHi(this.de.Hi()); break;
			case 0x5C: this.de.setHi(this.hl.Lo()); break;
			case 0x5D: this.de.setHi(this.hl.Hi()); break;
			case 0x5E: this.de.setHi(this.mmu.read(this.hl.Word())); break;
			case 0x5F: this.de.setHi(this.af.Lo()); break;

			case 0x60: this.hl.setLo(this.bc.Lo()); break;
			case 0x61: this.hl.setLo(this.bc.Hi()); break;
			case 0x62: this.hl.setLo(this.de.Lo()); break;
			case 0x63: this.hl.setLo(this.de.Hi()); break;
			case 0x64: this.hl.setLo(this.hl.Lo()); break;
			case 0x65: this.hl.setLo(this.hl.Hi()); break;
			case 0x66: this.hl.setLo(this.mmu.read(this.hl.Word())); break;
			case 0x67: this.hl.setLo(this.af.Lo()); break;

			case 0x68: this.hl.setHi(this.bc.Lo()); break;
			case 0x69: this.hl.setHi(this.bc.Hi()); break;
			case 0x6A: this.hl.setHi(this.de.Lo()); break;
			case 0x6B: this.hl.setHi(this.de.Hi()); break;
			case 0x6C: this.hl.setHi(this.hl.Lo()); break;
			case 0x6D: this.hl.setHi(this.hl.Hi()); break;
			case 0x6E: this.hl.setHi(this.mmu.read(this.hl.Word())); break;
			case 0x6F: this.hl.setHi(this.af.Lo()); break;

			case 0x70: this.mmu.write(this.hl.Word(), this.bc.Lo()); break;
			case 0x71: this.mmu.write(this.hl.Word(), this.bc.Hi()); break;
			case 0x72: this.mmu.write(this.hl.Word(), this.de.Lo()); break;
			case 0x73: this.mmu.write(this.hl.Word(), this.de.Hi()); break;
			case 0x74: this.mmu.write(this.hl.Word(), this.hl.Lo()); break;
			case 0x75: this.mmu.write(this.hl.Word(), this.hl.Hi()); break;

			case 0x76:
				this.halt = true;
				this.haltBug = (this.intStat & IOInterrupt.Stat_Enabled) == 0;
				break;

			case 0x77: this.mmu.write(this.hl.Word(), this.af.Lo()); break;

			case 0x78: this.af.setLo(this.bc.Lo()); break;
			case 0x79: this.af.setLo(this.bc.Hi()); break;
			case 0x7A: this.af.setLo(this.de.Lo()); break;
			case 0x7B: this.af.setLo(this.de.Hi()); break;
			case 0x7C: this.af.setLo(this.hl.Lo()); break;
			case 0x7D: this.af.setLo(this.hl.Hi()); break;
			case 0x7E: this.af.setLo(this.mmu.read(this.hl.Word())); break;
			case 0x7F: this.af.setLo(this.af.Lo()); break;

			case 0x80: this.af.setLo(this.add8(this.af.Lo(), this.bc.Lo(), false)); break;
			case 0x81: this.af.setLo(this.add8(this.af.Lo(), this.bc.Hi(), false)); break;
			case 0x82: this.af.setLo(this.add8(this.af.Lo(), this.de.Lo(), false)); break;
			case 0x83: this.af.setLo(this.add8(this.af.Lo(), this.de.Hi(), false)); break;
			case 0x84: this.af.setLo(this.add8(this.af.Lo(), this.hl.Lo(), false)); break;
			case 0x85: this.af.setLo(this.add8(this.af.Lo(), this.hl.Hi(), false)); break;
			case 0x86: this.af.setLo(this.add8(this.af.Lo(), this.mmu.read(this.hl.Word()), false)); break;
			case 0x87: this.af.setLo(this.add8(this.af.Lo(), this.af.Lo(), false)); break;
			case 0xC6: this.af.setLo(this.add8(this.af.Lo(), this.imm8(), false)); break;

			case 0x88: this.af.setLo(this.add8(this.af.Lo(), this.bc.Lo(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x89: this.af.setLo(this.add8(this.af.Lo(), this.bc.Hi(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x8A: this.af.setLo(this.add8(this.af.Lo(), this.de.Lo(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x8B: this.af.setLo(this.add8(this.af.Lo(), this.de.Hi(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x8C: this.af.setLo(this.add8(this.af.Lo(), this.hl.Lo(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x8D: this.af.setLo(this.add8(this.af.Lo(), this.hl.Hi(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x8E: this.af.setLo(this.add8(this.af.Lo(), this.mmu.read(this.hl.Word()), this.aflagIsSet(ArithFlag.C))); break;
			case 0x8F: this.af.setLo(this.add8(this.af.Lo(), this.af.Lo(), this.aflagIsSet(ArithFlag.C))); break;
			case 0xCE: this.af.setLo(this.add8(this.af.Lo(), this.imm8(), this.aflagIsSet(ArithFlag.C))); break;

			case 0x90: this.af.setLo(this.sub8(this.af.Lo(), this.bc.Lo(), false)); break;
			case 0x91: this.af.setLo(this.sub8(this.af.Lo(), this.bc.Hi(), false)); break;
			case 0x92: this.af.setLo(this.sub8(this.af.Lo(), this.de.Lo(), false)); break;
			case 0x93: this.af.setLo(this.sub8(this.af.Lo(), this.de.Hi(), false)); break;
			case 0x94: this.af.setLo(this.sub8(this.af.Lo(), this.hl.Lo(), false)); break;
			case 0x95: this.af.setLo(this.sub8(this.af.Lo(), this.hl.Hi(), false)); break;
			case 0x96: this.af.setLo(this.sub8(this.af.Lo(), this.mmu.read(this.hl.Word()), false)); break;
			case 0x97: this.af.setLo(this.sub8(this.af.Lo(), this.af.Lo(), false)); break;
			case 0xD6: this.af.setLo(this.sub8(this.af.Lo(), this.imm8(), false)); break;

			case 0x98: this.af.setLo(this.sub8(this.af.Lo(), this.bc.Lo(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x99: this.af.setLo(this.sub8(this.af.Lo(), this.bc.Hi(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x9A: this.af.setLo(this.sub8(this.af.Lo(), this.de.Lo(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x9B: this.af.setLo(this.sub8(this.af.Lo(), this.de.Hi(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x9C: this.af.setLo(this.sub8(this.af.Lo(), this.hl.Lo(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x9D: this.af.setLo(this.sub8(this.af.Lo(), this.hl.Hi(), this.aflagIsSet(ArithFlag.C))); break;
			case 0x9E: this.af.setLo(this.sub8(this.af.Lo(), this.mmu.read(this.hl.Word()), this.aflagIsSet(ArithFlag.C))); break;
			case 0x9F: this.af.setLo(this.sub8(this.af.Lo(), this.af.Lo(), this.aflagIsSet(ArithFlag.C))); break;
			case 0xDE: this.af.setLo(this.sub8(this.af.Lo(), this.imm8(), this.aflagIsSet(ArithFlag.C))); break;

			case 0xA0: this.and(this.bc.Lo()); break;
			case 0xA1: this.and(this.bc.Hi()); break;
			case 0xA2: this.and(this.de.Lo()); break;
			case 0xA3: this.and(this.de.Hi()); break;
			case 0xA4: this.and(this.hl.Lo()); break;
			case 0xA5: this.and(this.hl.Hi()); break;
			case 0xA6: this.and(this.mmu.read(this.hl.Word())); break;
			case 0xA7: this.and(this.af.Lo()); break;
			case 0xE6: this.and(this.imm8()); break;

			case 0xA8: this.xor(this.bc.Lo()); break;
			case 0xA9: this.xor(this.bc.Hi()); break;
			case 0xAA: this.xor(this.de.Lo()); break;
			case 0xAB: this.xor(this.de.Hi()); break;
			case 0xAC: this.xor(this.hl.Lo()); break;
			case 0xAD: this.xor(this.hl.Hi()); break;
			case 0xAE: this.xor(this.mmu.read(this.hl.Word())); break;
			case 0xAF: this.xor(this.af.Lo()); break;
			case 0xEE: this.xor(this.imm8()); break;

			case 0xB0: this.or(this.bc.Lo()); break;
			case 0xB1: this.or(this.bc.Hi()); break;
			case 0xB2: this.or(this.de.Lo()); break;
			case 0xB3: this.or(this.de.Hi()); break;
			case 0xB4: this.or(this.hl.Lo()); break;
			case 0xB5: this.or(this.hl.Hi()); break;
			case 0xB6: this.or(this.mmu.read(this.hl.Word())); break;
			case 0xB7: this.or(this.af.Lo()); break;
			case 0xF6: this.or(this.imm8()); break;

			case 0xB8: this.sub8(this.af.Lo(), this.bc.Lo(), false); break;
			case 0xB9: this.sub8(this.af.Lo(), this.bc.Hi(), false); break;
			case 0xBA: this.sub8(this.af.Lo(), this.de.Lo(), false); break;
			case 0xBB: this.sub8(this.af.Lo(), this.de.Hi(), false); break;
			case 0xBC: this.sub8(this.af.Lo(), this.hl.Lo(), false); break;
			case 0xBD: this.sub8(this.af.Lo(), this.hl.Hi(), false); break;
			case 0xBE: this.sub8(this.af.Lo(), this.mmu.read(this.hl.Word()), false); break;
			case 0xBF: this.sub8(this.af.Lo(), this.af.Lo(), false); break;
			case 0xFE: this.sub8(this.af.Lo(), this.imm8(), false); break;

			case 0xC1: this.bc = this.pop16(); break;
			case 0xD1: this.de = this.pop16(); break;
			case 0xE1: this.hl = this.pop16(); break;
			case 0xF1: this.af = this.pop16(); this.af.setHi(this.af.Hi() & 0xF0); break;

			case 0xC5: this.push16(this.bc); break;
			case 0xD5: this.push16(this.de); break;
			case 0xE5: this.push16(this.hl); break;
			case 0xF5: this.push16(this.af); break;

			case 0xEA: this.mmu.write(this.imm16(), this.af.Lo()); break;
			case 0xFA: this.af.setLo(this.mmu.read(this.imm16())); break;
			case 0xE9: this.pc = this.hl.Word(); break;

			case 0xC3: {
				const v = this.imm16();
				// if (v == orig_pc) ...

				this.jmpAbs(v);
				break;
			}

			case 0xC2: addCycles += this.jmpAbsCond(this.imm16(), !this.aflagIsSet(ArithFlag.Z)); break;
			case 0xCA: addCycles += this.jmpAbsCond(this.imm16(), this.aflagIsSet(ArithFlag.Z)); break;
			case 0xD2: addCycles += this.jmpAbsCond(this.imm16(), !this.aflagIsSet(ArithFlag.C)); break;
			case 0xDA: addCycles += this.jmpAbsCond(this.imm16(), this.aflagIsSet(ArithFlag.C)); break;

			case 0xE0: this.mmu.write(0xFF00 + this.imm8(), this.af.Lo()); break;
			case 0xE2: this.mmu.write(0xFF00 + this.bc.Hi(), this.af.Lo()); break;
			case 0xF0: this.af.setLo(this.mmu.read(0xFF00 + this.imm8())); break;
			case 0xF2: this.af.setLo(this.mmu.read(0xFF00 + this.bc.Hi())); break;

			case 0x18: {
				const v = this.imm8();
				// if (v == 0xFE) ...
				this.jmpRel(v);
				break;
			}

			case 0x20: addCycles += this.jmpRelCond(this.imm8(), !this.aflagIsSet(ArithFlag.Z)); break;
			case 0x28: addCycles += this.jmpRelCond(this.imm8(), this.aflagIsSet(ArithFlag.Z)); break;
			case 0x30: addCycles += this.jmpRelCond(this.imm8(), !this.aflagIsSet(ArithFlag.C)); break;
			case 0x38: addCycles += this.jmpRelCond(this.imm8(), this.aflagIsSet(ArithFlag.C)); break;

			case 0x20: addCycles += this.jmpRelCond(this.imm8(), !this.aflagIsSet(ArithFlag.Z)); break;
			case 0x28: addCycles += this.jmpRelCond(this.imm8(), this.aflagIsSet(ArithFlag.Z)); break;
			case 0x30: addCycles += this.jmpRelCond(this.imm8(), !this.aflagIsSet(ArithFlag.C)); break;
			case 0x38: addCycles += this.jmpRelCond(this.imm8(), this.aflagIsSet(ArithFlag.C)); break;

			case 0xC4: addCycles += this.jmpCallCond(this.imm16(), !this.aflagIsSet(ArithFlag.Z)); break;
			case 0xCC: addCycles += this.jmpCallCond(this.imm16(), this.aflagIsSet(ArithFlag.Z)); break;
			case 0xD4: addCycles += this.jmpCallCond(this.imm16(), !this.aflagIsSet(ArithFlag.C)); break;
			case 0xDC: addCycles += this.jmpCallCond(this.imm16(), this.aflagIsSet(ArithFlag.C)); break;
			case 0xCD: this.jmpCall(this.imm16()); break;

			case 0xC9: this.jmpRet(); break;
			case 0xC0: addCycles += this.jmpRetCond(!this.aflagIsSet(ArithFlag.Z)); break;
			case 0xC8: addCycles += this.jmpRetCond(this.aflagIsSet(ArithFlag.Z)); break;
			case 0xD0: addCycles += this.jmpRetCond(!this.aflagIsSet(ArithFlag.C)); break;
			case 0xD8: addCycles += this.jmpRetCond(this.aflagIsSet(ArithFlag.C)); break;

			case 0xC7: this.jmpCall(0x00); break;
			case 0xCF: this.jmpCall(0x08); break;
			case 0xD7: this.jmpCall(0x10); break;
			case 0xDF: this.jmpCall(0x18); break;
			case 0xE7: this.jmpCall(0x20); break;
			case 0xEF: this.jmpCall(0x28); break;
			case 0xF7: this.jmpCall(0x30); break;
			case 0xFF: this.jmpCall(0x38); break;

			case 0xD9: this.jmpRet(); this.intStat |= IOInterrupt.Stat_Enabled; break;
			case 0xF3: this.intStat = 0; break;
			case 0xFB: this.intStat |= IOInterrupt.Stat_Pending; break;

			case 0xCB: this.procCB(opcode2); break;

			default:
				throw 'Unhandled opcode ' + opcode1;
		}

		addCycles += opcode1 == 0xCB ? GB.INSTR_CYCLES_CB[opcode2] : GB.INSTR_CYCLES[opcode1];
		return addCycles;
	}
}
