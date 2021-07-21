import assert from 'assert';
import GB, { GBTimer } from './../src/gb';
import MMU, { IORegister } from './../src/mmu';
import PPU from '../src/ppu';
import fs from 'fs';

const tests: any = {};

const loadRom = (path: string): Buffer => fs.readFileSync(path);

const testRom = (path: string) => {
    console.log('Testing', path);
    const mmu = new MMU(loadRom(path));
    const ppu = new PPU(mmu);
    const gb = new GB(mmu);
    const gbTimer = new GBTimer(mmu);

    let serialOut = '';

    let step = 0;
    while (true) {
        ++step;

        if (mmu.readReg(IORegister.SerialControl) == 0x81) {
            const c = mmu.readReg(IORegister.SerialData);
            serialOut += String.fromCharCode(c);
            mmu.writeReg(IORegister.SerialControl, 0);

            if (serialOut.endsWith('Passed')) {
                return true;
            }

            if (serialOut.includes('Failed')) {
                assert.fail('Failed ' + path);
            }
        }

        const clks = gb.Step();
        ppu.Step(clks, true);
        gbTimer.Step(clks);
    }
}

testRom('./build/roms/cpu_instrs/individual/01-special.gb');
testRom('./build/roms/cpu_instrs/individual/02-interrupts.gb');
testRom('./build/roms/cpu_instrs/individual/03-op sp,hl.gb');
testRom('./build/roms/cpu_instrs/individual/04-op r,imm.gb');
testRom('./build/roms/cpu_instrs/individual/05-op rp.gb');
testRom('./build/roms/cpu_instrs/individual/06-ld r,r.gb');
testRom('./build/roms/cpu_instrs/individual/07-jr,jp,call,ret,rst.gb');
testRom('./build/roms/cpu_instrs/individual/08-misc instrs.gb');
testRom('./build/roms/cpu_instrs/individual/09-op r,r.gb');
testRom('./build/roms/cpu_instrs/individual/10-bit ops.gb');
testRom('./build/roms/cpu_instrs/individual/11-op a,(hl).gb');

// testRom('./build/roms/cpu_instrs/cpu_instrs.gb');
testRom('./build/roms/instr_timing/instr_timing.gb');

// testRom('./build/roms/bgbtest.gb');

// tests['foo'] = () => { assert.strictEqual(2, 3); }

for (let t in tests) {
    console.log('Test', t);
    tests[t]();
}
