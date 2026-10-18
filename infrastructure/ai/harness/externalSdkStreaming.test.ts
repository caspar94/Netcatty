import assert from 'node:assert/strict';
import test from 'node:test';
import type { AISession, ChatMessage, ExternalAgentConfig } from '../types';
import { SessionStateStore } from './sessionState';
import { ToolOutputStore } from './toolOutputStore';
import { ToolResultDedup } from './toolResultDedup';
import { externalSdkTurnDriver } from './turnDrivers/externalSdkTurnDriver';

async function startTurn(backend: 'codex' | 'opencode') {
  let event: ((value: Record<string, unknown>) => void) | undefined;
  let done: (() => void) | undefined;
  const updates: ChatMessage[] = [];
  const session: AISession = {
    id: `chat-${backend}`, title: 'Streaming', agentId: backend, scope: { type: 'global' },
    messages: [{ id: 'assistant', role: 'assistant', content: '', timestamp: 1 }], createdAt: 1, updatedAt: 1,
  };
  const controller = new AbortController();
  const config: ExternalAgentConfig = { id: backend, name: backend, command: backend, enabled: true, sdkBackend: backend };
  const run = externalSdkTurnDriver.run({
    backend: 'external-sdk', chatSessionId: session.id, assistantMsgId: 'assistant', userText: 'Inspect',
    signal: controller.signal, agentConfig: config, attachedImages: [],
    context: { terminalSessions: [], providers: [], toolIntegrationMode: 'mcp', selectedUserSkillSlugs: [], permissionMode: 'confirm' },
    bridge: {
      onAiSdkAgentEvent: (_id: unknown, callback: typeof event) => { event = callback; return () => {}; },
      onAiSdkAgentDone: (_id: unknown, callback: typeof done) => { done = callback; return () => {}; },
      onAiSdkAgentError: () => () => {},
      aiSdkAgentCancel: async () => ({ ok: true }),
      aiSdkAgentStream: async () => ({ ok: true }),
    },
    ui: {
      addMessageToSession: (_id, message) => { session.messages.push(message); },
      updateLastMessage: (_id, updater) => { session.messages[session.messages.length - 1] = updater(session.messages.at(-1)!); },
      updateMessageById: (_id, messageId, updater) => {
        const index = session.messages.findIndex((message) => message.id === messageId);
        if (index < 0) return;
        session.messages[index] = updater(session.messages[index]);
        updates.push(session.messages[index]);
      },
      reportStreamError: () => {}, setStreamingForScope: () => {}, getLatestSession: () => session,
    },
  }, {
    turnId: `turn-${backend}`, chatSessionId: session.id, sessionId: session.id, backend: 'external-sdk',
    signal: controller.signal, emit: () => {}, toolOutputStore: new ToolOutputStore(),
    toolResultDedup: new ToolResultDedup(), sessionStateStore: new SessionStateStore(),
  });
  for (let i = 0; i < 50 && (!event || !done); i++) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(event && done, 'SDK stream listeners must be ready');
  return { event, done, updates, session, run, controller };
}

function installFrames() {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  globalThis.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = (frameId) => { frames.delete(frameId); };
  return {
    frames,
    flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); },
    restore() { globalThis.requestAnimationFrame = originalRequest; globalThis.cancelAnimationFrame = originalCancel; },
  };
}

for (const backend of ['codex', 'opencode'] as const) {
  test(`${backend} batches reasoning bursts and mixed content without dropping output`, async () => {
    const frames = installFrames();
    const turn = await startTurn(backend);
    try {
      const chunks = Array.from({ length: 300 }, (_, index) => `reason-${index};`);
      chunks.forEach((delta) => turn.event({ type: 'reasoning-delta', delta }));
      assert.equal(turn.updates.length, 0);
      assert.equal(frames.frames.size, 1);
      frames.flush();
      assert.equal(turn.updates.length, 1);
      assert.equal(turn.session.messages[0].thinking, chunks.join(''));

      turn.event({ type: 'text-delta', textDelta: 'answer A' });
      turn.event({ type: 'reasoning-delta', delta: 'more reasoning' });
      turn.event({ type: 'text-delta', textDelta: 'answer B' });
      frames.flush();
      assert.equal(turn.updates.length, 2);
      assert.equal(turn.session.messages[0].content, 'answer Aanswer B');
      assert.equal(turn.session.messages[0].thinking, chunks.join('') + 'more reasoning');

      turn.event({ type: 'text-delta', textDelta: 'final tail' });
      turn.done();
      await turn.run;
      assert.equal(turn.session.messages[0].content, 'answer Aanswer Bfinal tail');
      assert.equal(frames.frames.size, 0, 'completion cancels the queued frame');
    } finally {
      turn.controller.abort(); await turn.run; frames.restore();
    }
  });
}

test('tool boundaries and cancellation flush pending reasoning and text', async () => {
  const frames = installFrames();
  const turn = await startTurn('codex');
  try {
    turn.event({ type: 'reasoning-delta', delta: 'inspect first' });
    turn.event({ type: 'text-delta', textDelta: 'before tool' });
    turn.event({ type: 'tool-call', toolName: 'shell', toolCallId: 'call', args: { command: 'true' } });
    assert.equal(turn.updates[0].content, 'before tool');
    assert.equal(turn.updates[0].thinking, 'inspect first');
    assert.equal(turn.updates[0].toolCalls, undefined);
    assert.equal(turn.updates[1].toolCalls?.[0].id, 'call');
    assert.equal(frames.frames.size, 0);
    turn.event({ type: 'reasoning-delta', delta: 'last thought' });
    turn.controller.abort();
    await turn.run;
    assert.equal(turn.session.messages[0].thinking, 'inspect firstlast thought');
    assert.equal(frames.frames.size, 0);
  } finally {
    turn.controller.abort(); await turn.run; frames.restore();
  }
});
