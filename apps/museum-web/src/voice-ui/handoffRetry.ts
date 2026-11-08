/** Retry only a just-switched voice panel's transient websocket upgrade failure. */
export async function connectAfterHandoff(
  connect: () => Promise<void>,
  mayRetry: boolean,
  alive: () => boolean,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await connect();
      return;
    } catch (error) {
      if (!mayRetry || !alive() || attempt >= 2 || !(error instanceof Error)
        || !error.message.includes("浏览器WebSocket代理（upgrade_error）")) throw error;
      await wait(700 * (attempt + 1));
      if (!alive()) throw error;
    }
  }
}
