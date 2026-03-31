import type {
  DiffSyntaxToken,
  DiffSyntaxWorkerRequestItem,
  DiffSyntaxWorkerRequestMessage,
  DiffSyntaxWorkerResponseMessage,
} from "./diffSyntax";

const tokenCache = new Map<string, DiffSyntaxToken[]>();

let worker: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;

const pendingRequests = new Map<
  number,
  {
    resolve: (value: Record<string, DiffSyntaxToken[]>) => void;
    reject: (error: unknown) => void;
  }
>();

export function canUseDiffSyntaxWorker(): boolean {
  return !workerFailed && typeof window !== "undefined" && typeof Worker !== "undefined";
}

export function readCachedDiffSyntaxTokens(cacheKey: string): DiffSyntaxToken[] | null {
  return tokenCache.get(cacheKey) ?? null;
}

export function requestDiffSyntaxTokens(
  items: DiffSyntaxWorkerRequestItem[],
): Promise<Record<string, DiffSyntaxToken[]>> {
  const missingItems = [...new Map(items.map((item) => [item.cacheKey, item])).values()].filter(
    (item) => !tokenCache.has(item.cacheKey),
  );

  if (missingItems.length === 0) {
    return Promise.resolve(buildTokenMap(items));
  }

  if (!canUseDiffSyntaxWorker()) {
    return Promise.reject(new Error("Diff syntax worker is unavailable."));
  }

  const requestId = nextRequestId;
  nextRequestId += 1;

  const message: DiffSyntaxWorkerRequestMessage = {
    requestId,
    items: missingItems,
  };

  return new Promise<Record<string, DiffSyntaxToken[]>>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    getWorker().postMessage(message);
  }).then((tokensByCacheKey) => {
    for (const [cacheKey, tokens] of Object.entries(tokensByCacheKey)) {
      tokenCache.set(cacheKey, tokens);
    }

    return buildTokenMap(items);
  });
}

function buildTokenMap(items: DiffSyntaxWorkerRequestItem[]): Record<string, DiffSyntaxToken[]> {
  const entries = items.flatMap((item) => {
    const tokens = tokenCache.get(item.cacheKey);
    return tokens ? [[item.cacheKey, tokens] as const] : [];
  });

  return Object.fromEntries(entries);
}

function getWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL("../workers/diffSyntax.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = handleWorkerMessage;
  worker.onerror = handleWorkerError;

  return worker;
}

function handleWorkerMessage(event: MessageEvent<DiffSyntaxWorkerResponseMessage>): void {
  const pending = pendingRequests.get(event.data.requestId);
  if (!pending) {
    return;
  }

  pendingRequests.delete(event.data.requestId);
  pending.resolve(
    Object.fromEntries(event.data.items.map((item) => [item.cacheKey, item.tokens] as const)),
  );
}

function handleWorkerError(event: ErrorEvent): void {
  workerFailed = true;

  const error = event.error ?? new Error(event.message || "Diff syntax worker failed.");
  for (const pending of pendingRequests.values()) {
    pending.reject(error);
  }
  pendingRequests.clear();

  if (worker) {
    worker.terminate();
    worker = null;
  }
}
