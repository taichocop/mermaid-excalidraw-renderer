// The SDK package contains typings only. No real app/vault exists in unit tests.
export class PluginSettingTab {}
export class Scope {
  constructor(readonly parent?: Scope) {}
  readonly handlers: { modifiers: unknown; key: string | null; callback: (event: KeyboardEvent) => boolean | void }[] = [];
  register(modifiers: unknown, key: string | null, callback: (event: KeyboardEvent) => boolean | void) {
    const handler = { modifiers, key, callback }; this.handlers.push(handler); return handler;
  }
}
