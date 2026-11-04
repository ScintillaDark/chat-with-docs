import { describe, expect, it } from "vitest";

import { AiBusyError, withLocalAiSlot } from "./ai-gate";

describe("withLocalAiSlot", () => {
  it("rejects overlapping model work and releases the slot after completion", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = withLocalAiSlot(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );

    await expect(withLocalAiSlot(async () => "second")).rejects.toBeInstanceOf(
      AiBusyError,
    );

    releaseFirst?.();
    await expect(first).resolves.toBeUndefined();
    await expect(withLocalAiSlot(async () => "next")).resolves.toBe("next");
  });
});
