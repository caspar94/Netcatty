export type TerminalFitOptions = {
  force?: boolean;
  requireVisible?: boolean;
  immediate?: boolean;
  allowHidden?: boolean;
};

const mergeOptions = (previous: TerminalFitOptions, next: TerminalFitOptions): TerminalFitOptions => ({
  force: previous.force || next.force,
  requireVisible: previous.requireVisible || next.requireVisible,
  immediate: previous.immediate || next.immediate,
  allowHidden: previous.allowHidden || next.allowHidden,
});

/** Coalesce layout notifications before reading DOM geometry or rebuilding glyphs. */
export function createTerminalFitFrameScheduler(
  fit: (options: TerminalFitOptions) => void,
  requestFrame: (callback: FrameRequestCallback) => number = (callback) => requestAnimationFrame(callback),
  cancelFrame: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let frameId: number | null = null;
  let pending: TerminalFitOptions | null = null;

  const consume = (options: TerminalFitOptions = {}): TerminalFitOptions => {
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    const merged = pending ? mergeOptions(pending, options) : options;
    pending = null;
    return merged;
  };

  return {
    schedule(options: TerminalFitOptions = {}) {
      pending = pending ? mergeOptions(pending, options) : options;
      if (frameId !== null) return;
      frameId = requestFrame(() => {
        frameId = null;
        fit({ ...consume(), immediate: true });
      });
    },
    consume,
    dispose() {
      consume();
    },
  };
}
