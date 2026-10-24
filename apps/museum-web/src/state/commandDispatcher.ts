export type CommandRequestId = string;
export type CommandSender<T> = (requestId: CommandRequestId) => Promise<T>;

/** Shares duplicate in-flight UI actions and gives the server one stable id per command. */
export class CommandDispatcher {
  private readonly pending = new Map<string, Promise<unknown>>();

  dispatch<T>(key: string, send: CommandSender<T>): Promise<T> {
    const current = this.pending.get(key);
    if (current) return current as Promise<T>;

    const requestId = crypto.randomUUID();
    const task = send(requestId).finally(() => {
      if (this.pending.get(key) === task) this.pending.delete(key);
    });
    this.pending.set(key, task);
    return task;
  }
}
