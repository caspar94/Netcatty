import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalFitFrameScheduler, type TerminalFitOptions } from './terminalFitFrameScheduler';

function setup() {
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const fits: TerminalFitOptions[] = [];
  const scheduler = createTerminalFitFrameScheduler(
    (options) => fits.push(options),
    (callback) => { frames.set(++nextId, callback); return nextId; },
    (id) => { frames.delete(id); },
  );
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };
  return { scheduler, fits, frames, flush };
}

test('a layout burst runs one fit and preserves a forced font/visibility recovery', () => {
  const { scheduler, fits, frames, flush } = setup();
  for (let i = 0; i < 50; i++) scheduler.schedule();
  scheduler.schedule({ force: true, requireVisible: true });
  scheduler.schedule({ allowHidden: true });
  assert.equal(frames.size, 1);
  assert.equal(fits.length, 0);
  flush();
  assert.deepEqual(fits, [{ force: true, requireVisible: true, immediate: true, allowHidden: true }]);
  scheduler.schedule();
  flush();
  assert.equal(fits.length, 2, 'later frames still fit normally');
  assert.equal(fits[1].force, undefined, 'recovery flags do not leak into later fits');
});

test('an immediate fit consumes queued recovery without another fit on the next frame', () => {
  const { scheduler, fits, frames, flush } = setup();
  scheduler.schedule({ force: true });
  const options = scheduler.consume({ immediate: true, requireVisible: true });
  assert.equal(options.force, true);
  assert.equal(options.requireVisible, true);
  assert.equal(options.immediate, true);
  assert.equal(frames.size, 0);
  flush();
  assert.equal(fits.length, 0);
});

test('disposing cancels pending work and permits an effect remount', () => {
  const { scheduler, fits, flush } = setup();
  scheduler.schedule();
  scheduler.dispose();
  flush();
  assert.equal(fits.length, 0);
  scheduler.schedule();
  flush();
  assert.equal(fits.length, 1);
});
