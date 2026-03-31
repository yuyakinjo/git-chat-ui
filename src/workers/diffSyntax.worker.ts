/// <reference lib="WebWorker" />

import {
  highlightDiffSyntaxLineSync,
  type DiffSyntaxWorkerResponseItem,
  type DiffSyntaxWorkerRequestMessage,
  type DiffSyntaxWorkerResponseMessage
} from '../lib/diffSyntax';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<DiffSyntaxWorkerRequestMessage>): void => {
  const items: DiffSyntaxWorkerResponseItem[] = event.data.items.map((item) => ({
    cacheKey: item.cacheKey,
    tokens: highlightDiffSyntaxLineSync(item.content, item.language, item.theme)
  }));

  const response: DiffSyntaxWorkerResponseMessage = {
    requestId: event.data.requestId,
    items
  };

  self.postMessage(response);
};

export { };
