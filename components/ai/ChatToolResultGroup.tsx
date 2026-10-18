import React, { memo } from 'react';
import type { ChatMessage } from '../../infrastructure/ai/types';
import { ToolCall } from '../ai-elements/tool-call';
import ToolCallGroup from './ToolCallGroup';
import { getAIPanelProfilerProps } from './aiPanelDiagnostics';
import { parseTerminalToolArtifact } from './toolArtifacts/terminalToolArtifact';
import { TerminalArtifactToolResult } from './toolArtifacts/TerminalArtifactToolResult';
import {
  inferArtifactToolNameFromCliArgs,
  normalizeArtifactToolName,
} from './toolArtifacts/toolArtifactNames';
import { parseVaultToolArtifact } from './toolArtifacts/vaultToolArtifact';
import { VaultArtifactToolResult } from './toolArtifacts/VaultArtifactToolResult';

export interface ChatToolResultEntry {
  result: NonNullable<ChatMessage['toolResults']>[number];
  pairedToolName?: string;
  args?: Record<string, unknown>;
}

interface ChatToolResultGroupProps {
  entries: ChatToolResultEntry[];
  defaultExpanded: boolean;
}

function ToolResultItems({ entries }: Pick<ChatToolResultGroupProps, 'entries'>) {
  return entries.map(({ result, pairedToolName, args }) => {
    const resultToolName = typeof result.toolName === 'string' ? result.toolName : undefined;
    const name = pairedToolName || resultToolName || result.toolCallId;
    const artifactToolName = inferArtifactToolNameFromCliArgs(args)
      ?? normalizeArtifactToolName(resultToolName)
      ?? normalizeArtifactToolName(pairedToolName)
      ?? name;
    const terminalArtifact = parseTerminalToolArtifact(artifactToolName, result.content);
    if (terminalArtifact) {
      return (
        <TerminalArtifactToolResult
          key={result.toolCallId}
          artifact={terminalArtifact}
          toolName={artifactToolName}
          args={args}
          result={result.content}
          isError={result.isError}
        />
      );
    }
    const artifact = parseVaultToolArtifact(artifactToolName, result.content);
    if (artifact) {
      return (
        <VaultArtifactToolResult
          key={result.toolCallId}
          artifact={artifact}
          toolName={artifactToolName}
          args={args}
          result={result.content}
          isError={result.isError}
        />
      );
    }
    return (
      <React.Profiler key={result.toolCallId} {...getAIPanelProfilerProps('AIChatPanel.ToolCall.Result')}>
        <div>
          <ToolCall name={name} args={args} result={result.content} isError={result.isError} />
        </div>
      </React.Profiler>
    );
  });
}

function ChatToolResultGroupView({ entries, defaultExpanded }: ChatToolResultGroupProps) {
  if (entries.length === 1) {
    return <div className="py-0.5"><ToolResultItems entries={entries} /></div>;
  }
  return (
    <ToolCallGroup count={entries.length} defaultExpanded={defaultExpanded}>
      {/* Parse and render results only when this group is actually expanded. */}
      <ToolResultItems entries={entries} />
    </ToolCallGroup>
  );
}

export const ChatToolResultGroup = memo(ChatToolResultGroupView, (previous, next) => (
  previous.defaultExpanded === next.defaultExpanded
  && previous.entries.length === next.entries.length
  && previous.entries.every((entry, index) => (
    entry.result === next.entries[index].result
    && entry.pairedToolName === next.entries[index].pairedToolName
    && entry.args === next.entries[index].args
  ))
));
