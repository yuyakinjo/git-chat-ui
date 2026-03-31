import { useEffect, useRef, useState } from 'react';

import { canUseDiffSyntaxWorker, readCachedDiffSyntaxTokens, requestDiffSyntaxTokens } from '../lib/diffSyntaxWorkerClient';
import type { DiffSyntaxToken, DiffSyntaxWorkerRequestItem } from '../lib/diffSyntax';

export function useDiffSyntaxTokenMap(requests: DiffSyntaxWorkerRequestItem[]): Record<string, DiffSyntaxToken[]> {
  const [tokenMap, setTokenMap] = useState<Record<string, DiffSyntaxToken[]>>({});
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    if (requests.length === 0 || !canUseDiffSyntaxWorker()) {
      setTokenMap({});
      return;
    }

    const cachedEntries = requests.flatMap((request) => {
      const tokens = readCachedDiffSyntaxTokens(request.cacheKey);
      return tokens ? [[request.cacheKey, tokens] as const] : [];
    });

    setTokenMap(Object.fromEntries(cachedEntries));

    const missingRequests = requests.filter((request) => readCachedDiffSyntaxTokens(request.cacheKey) === null);
    if (missingRequests.length === 0) {
      return;
    }

    void requestDiffSyntaxTokens(missingRequests)
      .then((nextTokenMap) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setTokenMap((current) => ({
          ...current,
          ...nextTokenMap
        }));
      })
      .catch(() => {});
  }, [requests]);

  return tokenMap;
}
