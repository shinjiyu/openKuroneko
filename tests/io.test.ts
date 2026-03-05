import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIORegistry, createFileInputEndpoint, createFileOutputEndpoint } from '../src/io/index.js';

const TMP = path.join(os.tmpdir(), 'kuroneko-test-io');
fs.mkdirSync(TMP, { recursive: true });

describe('FileInputEndpoint', () => {
  it('returns null when file does not exist', async () => {
    const ep = createFileInputEndpoint('t', path.join(TMP, 'no-such-input'));
    expect(await ep.read()).toBeNull();
  });

  it('reads and consumes content', async () => {
    const p = path.join(TMP, 'input-1');
    fs.writeFileSync(p, 'hello', 'utf8');
    const ep = createFileInputEndpoint('t', p);

    expect(await ep.read()).toBe('hello');
    // consumed → next read is null
    expect(await ep.read()).toBeNull();
  });

  it('returns null for empty file', async () => {
    const p = path.join(TMP, 'input-empty');
    fs.writeFileSync(p, '', 'utf8');
    const ep = createFileInputEndpoint('t', p);
    expect(await ep.read()).toBeNull();
  });
});

describe('FileOutputEndpoint', () => {
  it('writes content to file', async () => {
    const p = path.join(TMP, 'output-1');
    const ep = createFileOutputEndpoint('t', p);
    await ep.write('world');
    expect(fs.readFileSync(p, 'utf8')).toBe('world');
  });

  it('overwrites on second write', async () => {
    const p = path.join(TMP, 'output-2');
    const ep = createFileOutputEndpoint('t', p);
    await ep.write('first');
    await ep.write('second');
    expect(fs.readFileSync(p, 'utf8')).toBe('second');
  });
});

describe('IORegistry', () => {
  it('registers and retrieves endpoints', () => {
    const reg = createIORegistry();
    const inp = createFileInputEndpoint('a', '/dev/null');
    const out = createFileOutputEndpoint('b', '/dev/null');
    reg.registerInput(inp);
    reg.registerOutput(out);
    expect(reg.getInput('a')).toBe(inp);
    expect(reg.getOutput('b')).toBe(out);
    expect(reg.getInput('x')).toBeUndefined();
  });

  it('lists registered ids', () => {
    const reg = createIORegistry();
    reg.registerInput(createFileInputEndpoint('i1', '/dev/null'));
    reg.registerInput(createFileInputEndpoint('i2', '/dev/null'));
    reg.registerOutput(createFileOutputEndpoint('o1', '/dev/null'));
    expect(reg.listInputs()).toEqual(['i1', 'i2']);
    expect(reg.listOutputs()).toEqual(['o1']);
  });
});
