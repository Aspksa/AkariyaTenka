import { z } from "zod";
import type { ComponentHealth } from "@akariya/core";
import { assistantRoleSchema, assistantToolCallSchema } from "./model.js";

export const conversationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/u);
export const turnIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);
export const messageIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/u);

export const conversationSessionSchema = z.object({
  id: conversationIdSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive()
}).strict();
export type ConversationSession = z.infer<typeof conversationSessionSchema>;

export const conversationMessageSchema = z.object({
  id: messageIdSchema,
  sessionId: conversationIdSchema,
  turnId: turnIdSchema,
  role: assistantRoleSchema,
  content: z.string().max(200_000),
  createdAt: z.string().datetime(),
  correlationId: z.string().min(8).max(128),
  toolCallId: z.string().min(1).max(128).optional(),
  toolName: z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/u).optional(),
  toolCalls: z.array(assistantToolCallSchema).max(8).optional()
}).strict();
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export interface ConversationStore {
  createSession(session: ConversationSession): Promise<void>;
  getSession(sessionId: string): Promise<ConversationSession | null>;
  appendMessage(message: ConversationMessage): Promise<void>;
  listMessages(sessionId: string, limit?: number): Promise<readonly ConversationMessage[]>;
  listTurnMessages(sessionId: string, turnId: string): Promise<readonly ConversationMessage[]>;
  flush(): Promise<void>;
  health(): Promise<ComponentHealth>;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly messages: ConversationMessage[] = [];

  async createSession(session: ConversationSession): Promise<void> {
    const safe = conversationSessionSchema.parse(session);
    if (this.sessions.has(safe.id)) throw new Error("Conversation session already exists");
    this.sessions.set(safe.id, safe);
  }

  async getSession(sessionId: string): Promise<ConversationSession | null> {
    conversationIdSchema.parse(sessionId);
    return this.sessions.get(sessionId) ?? null;
  }

  async appendMessage(message: ConversationMessage): Promise<void> {
    const safe = conversationMessageSchema.parse(message);
    if (!this.sessions.has(safe.sessionId)) throw new Error("Conversation session does not exist");
    if (this.messages.some((entry) => entry.id === safe.id)) throw new Error("Conversation message already exists");
    this.messages.push(safe);

    const session = this.sessions.get(safe.sessionId);
    if (session !== undefined) {
      this.sessions.set(safe.sessionId, {
        ...session,
        updatedAt: safe.createdAt,
        version: session.version + 1
      });
    }
  }

  async listMessages(sessionId: string, limit = 64): Promise<readonly ConversationMessage[]> {
    conversationIdSchema.parse(sessionId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw new Error("Conversation limit is out of bounds");
    return this.messages.filter((entry) => entry.sessionId === sessionId).slice(-limit);
  }

  async listTurnMessages(sessionId: string, turnId: string): Promise<readonly ConversationMessage[]> {
    conversationIdSchema.parse(sessionId);
    turnIdSchema.parse(turnId);
    return this.messages.filter((entry) => entry.sessionId === sessionId && entry.turnId === turnId);
  }

  async flush(): Promise<void> {}

  async health(): Promise<ComponentHealth> {
    return { state: "started", recoverable: true };
  }
}
