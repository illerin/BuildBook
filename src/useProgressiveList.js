import { useEffect, useMemo, useRef, useState } from 'react';

export function useProgressiveList(items, resetKey, batchSize = 80) {
  const [limit, setLimit] = useState(batchSize);
  const sentinelRef = useRef(null);
  const visibleItems = useMemo(() => items.slice(0, limit), [items, limit]);
  const hasMore = limit < items.length;

  useEffect(() => setLimit(batchSize), [resetKey, batchSize]);

  useEffect(() => {
    if (!hasMore || !sentinelRef.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setLimit((current) => Math.min(items.length, current + batchSize));
      }
    }, { rootMargin: '400px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, items.length, batchSize]);

  return {
    visibleItems,
    hasMore,
    sentinelRef,
    loadMore: () => setLimit((current) => Math.min(items.length, current + batchSize)),
  };
}
