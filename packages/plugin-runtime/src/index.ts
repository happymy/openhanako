export type MaybePromise<T> = T | Promise<T>;

export type JsonSchema = Record<string, unknown>;

export interface HanaToolResult {
  content?: Array<Record<string, unknown>>;
  details?: Record<string, unknown>;
}

export interface HanaToolContext {
  pluginId: string;
  pluginDir: string;
  dataDir: string;
  sessionPath?: string | null;
  bus: HanaEventBus;
  config: HanaPluginConfigStore;
  log: HanaPluginLogger;
  registerSessionFile?: (input: Record<string, unknown>) => unknown;
  stageFile?: (input: Record<string, unknown>) => unknown;
  [key: string]: unknown;
}

export interface HanaToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  parameters?: JsonSchema;
  promptSnippet?: string;
  promptGuidelines?: string;
  execute(input: Input, ctx: HanaToolContext): MaybePromise<Output>;
}

export type HanaSlashPermission = 'anyone' | 'owner' | 'admin';
export type HanaSlashScope = 'session' | 'global';

export interface HanaCommandContext {
  [key: string]: unknown;
}

export interface HanaCommandResult {
  reply?: string;
  silent?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface HanaCommandDefinition<Context = HanaCommandContext> {
  name: string;
  aliases?: string[];
  description?: string;
  scope?: HanaSlashScope;
  permission?: HanaSlashPermission;
  usage?: string;
  handler?: (ctx: Context) => MaybePromise<HanaCommandResult | void>;
  execute?: (ctx: Context) => MaybePromise<unknown>;
}

export interface HanaProviderDefinition {
  id: string;
  name?: string;
  api?: string;
  models?: unknown[];
  [key: string]: unknown;
}

export type HanaExtensionFactory<Pi = unknown> = (pi: Pi) => MaybePromise<void>;

export interface HanaPluginConfigStore {
  get<T = unknown>(key: string): MaybePromise<T | undefined>;
  set<T = unknown>(key: string, value: T): MaybePromise<void>;
}

export interface HanaEventBus {
  emit(type: string, payload?: unknown): unknown;
  subscribe(type: string, handler: (payload: unknown) => void): () => void;
  request<T = unknown>(type: string, payload?: unknown, options?: Record<string, unknown>): Promise<T>;
  hasHandler?(type: string): boolean;
  handle?(type: string, handler: (payload: unknown) => MaybePromise<unknown>): () => void;
}

export interface HanaPluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface HanaPluginContext {
  pluginId: string;
  pluginDir: string;
  dataDir: string;
  bus: HanaEventBus;
  config: HanaPluginConfigStore;
  log: HanaPluginLogger;
  registerTool?: (tool: HanaToolDefinition) => () => void;
  registerSessionFile?: (input: Record<string, unknown>) => unknown;
  [key: string]: unknown;
}

export type HanaPluginDisposable = () => void;

export interface HanaPluginLifecycleHelpers {
  register(disposable: HanaPluginDisposable): void;
}

export interface HanaPluginLifecycle {
  onload?(ctx: HanaPluginContext, helpers: HanaPluginLifecycleHelpers): MaybePromise<void>;
  onunload?(ctx: HanaPluginContext): MaybePromise<void>;
}

export interface HanaPluginInstance {
  ctx: HanaPluginContext;
  register: (disposable: HanaPluginDisposable) => void;
  onload?(): MaybePromise<void>;
  onunload?(): MaybePromise<void>;
}

const EMPTY_PARAMETERS: JsonSchema = { type: 'object', properties: {} };

export function defineTool<Input = unknown, Output = unknown>(
  definition: HanaToolDefinition<Input, Output>,
): HanaToolDefinition<Input, Output> & { parameters: JsonSchema } {
  return {
    ...definition,
    parameters: definition.parameters ?? EMPTY_PARAMETERS,
  };
}

export function defineCommand<Context = HanaCommandContext>(
  definition: HanaCommandDefinition<Context>,
): HanaCommandDefinition<Context> {
  return { ...definition };
}

export function defineProvider<T extends HanaProviderDefinition>(definition: T): T {
  return definition;
}

export function defineExtension<Pi = unknown>(factory: HanaExtensionFactory<Pi>): HanaExtensionFactory<Pi> {
  return factory;
}

export function definePlugin(lifecycle: HanaPluginLifecycle): new () => HanaPluginInstance {
  return class DefinedHanaPlugin implements HanaPluginInstance {
    ctx!: HanaPluginContext;
    register!: (disposable: HanaPluginDisposable) => void;

    async onload(): Promise<void> {
      await lifecycle.onload?.(this.ctx, { register: this.register });
    }

    async onunload(): Promise<void> {
      await lifecycle.onunload?.(this.ctx);
    }
  };
}
