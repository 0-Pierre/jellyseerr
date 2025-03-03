import { useEffect, useMemo, useRef, useState } from 'react';

interface ItemWithCover {
  id: string | number;
  posterPath?: string | null;
  needsCoverArt?: boolean;
}

export function useProgressiveCovers<T extends ItemWithCover>(
  items: T[],
  batchSize = 20
): T[] {
  const itemsRef = useRef<T[]>(items);
  const [coverLoadTrigger, setCoverLoadTrigger] = useState(0);
  const requestedIdsRef = useRef<Set<string | number>>(new Set());
  const pendingRequestsRef = useRef<Map<string | number, Promise<unknown>>>(
    new Map()
  );
  const isProcessingRef = useRef<boolean>(false);
  const itemsSignatureRef = useRef<string>('');

  useEffect(() => {
    const currentSignature = JSON.stringify(items.map((item) => item.id));

    if (currentSignature === itemsSignatureRef.current) {
      return;
    }

    itemsSignatureRef.current = currentSignature;

    const newItems = [...items];
    const oldItemsMap = new Map(
      itemsRef.current.map((item) => [item.id, item])
    );

    let hasChanges = false;
    for (let i = 0; i < newItems.length; i++) {
      const existingItem = oldItemsMap.get(newItems[i].id);
      if (existingItem && existingItem.posterPath && !newItems[i].posterPath) {
        newItems[i] = {
          ...newItems[i],
          posterPath: existingItem.posterPath,
          needsCoverArt: false,
        };
        hasChanges = true;
      }
    }

    if (hasChanges || newItems.length !== itemsRef.current.length) {
      itemsRef.current = newItems;
      setCoverLoadTrigger((prev) => prev + 1);
    }
  }, [items]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enhancedItems = useMemo(() => itemsRef.current, [coverLoadTrigger]);

  useEffect(() => {
    const itemsNeedingCovers = itemsRef.current.filter(
      (item) =>
        item?.needsCoverArt &&
        item?.id &&
        !requestedIdsRef.current.has(item.id) &&
        !pendingRequestsRef.current.has(item.id)
    );

    if (isProcessingRef.current || !itemsNeedingCovers.length) return;

    isProcessingRef.current = true;

    const processNextBatch = async (startIdx: number) => {
      if (startIdx >= itemsNeedingCovers.length) {
        isProcessingRef.current = false;
        return;
      }

      const batch = itemsNeedingCovers
        .slice(startIdx, startIdx + batchSize)
        .map((item) => item.id)
        .filter(Boolean);

      if (batch.length === 0) {
        isProcessingRef.current = false;
        return;
      }

      batch.forEach((id) => requestedIdsRef.current.add(id));

      try {
        const batchUrl = `/api/v1/coverart/batch/${batch
          .map((id) => String(id))
          .join(',')}`;

        const requestPromise = fetch(batchUrl)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Error fetching cover art: ${response.status}`);
            }
            return response.json();
          })
          .then((coverData) => {
            if (Object.keys(coverData).length > 0) {
              const newItems = [...itemsRef.current];
              let hasUpdates = false;

              for (let i = 0; i < newItems.length; i++) {
                const item = newItems[i];
                if (item?.id && coverData[item.id]) {
                  newItems[i] = {
                    ...item,
                    posterPath: coverData[item.id],
                    needsCoverArt: false,
                  };
                  hasUpdates = true;
                }
              }

              if (hasUpdates) {
                itemsRef.current = newItems;
                setCoverLoadTrigger((prev) => prev + 1);
              }
            }

            batch.forEach((id) => pendingRequestsRef.current.delete(id));
            return coverData;
          })
          .catch((err) => {
            batch.forEach((id) => pendingRequestsRef.current.delete(id));
            throw err;
          });

        batch.forEach((id) =>
          pendingRequestsRef.current.set(id, requestPromise)
        );

        await requestPromise;

        setTimeout(() => {
          processNextBatch(startIdx + batchSize);
        }, 300);
      } catch (error) {
        setTimeout(() => {
          processNextBatch(startIdx + batchSize);
        }, 300);
      }
    };

    processNextBatch(0);
  }, [coverLoadTrigger, batchSize]);

  return enhancedItems;
}
