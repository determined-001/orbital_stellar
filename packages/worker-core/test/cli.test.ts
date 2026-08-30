import { describe,it,expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const pkg = path.resolve(__dirname, '..');
const bin = path.join(pkg, 'bin', 'orbital-worker');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args)=>spawnSync(process.execPath,[bin,...args)l{cwd:pkg,encoding:'utf8'});
describe('cli',()=>{
it('help', ()=>{
for(const c of ['register','list','inspect','dry-run','run']){
const r=run(['worker',c,'--help']);expect(r.status).toBe(0);expect(r.stdout).toContain(c);expect(r.stdout).toContain('--help');
}
});
it('secret', ()=>{
const r=run(['worker','register','foo','--secret','rawsecret']);expect(r.status).not.toBe(0);expect(r.stderr).toContain('--secret must be of the form env:VAR_NAME or file:PATH');
});
it('env/file', ()=>{
const r=run(['worker','register','foo','--secret','env:UNSET_TEST_VAR']);expect(r.status).not.toBe(0);expect(r.stderr).toContain('not set');
});
it('pack', ()=>{
const t=fs.mkdtempSync(true);try{
const p=JSON.parse(execFileSync(npm,["pack","--json","--pack-destination",t],{cwd:pkg,encoding:'utf8'}));const tars=path.join(t,p[0].filename);execFileSync(npm,["init","-y"],{cwd:t,encoding:'utf8'});execFileSync(npm,["install",tars],{cwd:t,encoding:'utf8'});const e={...process.env,PATH:path.join(t,'node_modules','.bin')+path.delimiter+process.env.PATH};for(const b of ['orbital','orbital-worker']){const r=spawnSync(b,['worker','--help'],{cwd:t,encoding:'utf8',});expect(r.status).toBe(0);expect(r.stdout).toContain('orbital worker');}
}finally{f.rmSync(t,{recursive:true,force:true});
},120000);
});