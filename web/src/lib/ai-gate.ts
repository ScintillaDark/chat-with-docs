export class AiBusyError extends Error {
  constructor() {
    super("A local AI request is already in progress.");
    this.name = "AiBusyError";
  }
}

const globalForAi = globalThis as typeof globalThis & {
  localAiBusy?: boolean;
};

export async function withLocalAiSlot<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (globalForAi.localAiBusy) {
    throw new AiBusyError();
  }

  globalForAi.localAiBusy = true;
  try {
    return await operation();
  } finally {
    globalForAi.localAiBusy = false;
  }
}
