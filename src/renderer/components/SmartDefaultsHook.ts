import { useEffect, useState } from 'react';
import api from '../lib/api';

/**
 * useSuggestedCategory - returns the most-frequently-used category id
 * for a given vendor, based on historical expense data.
 */
export function useSuggestedCategory(vendorId?: string): string | null {
  const [suggested, setSuggested] = useState<string | null>(null);
  useEffect(() => {
    if (!vendorId) { setSuggested(null); return; }
    api.intelSuggestCategory(vendorId)
      .then((id: string | null) => setSuggested(id))
      .catch(() => setSuggested(null));
  }, [vendorId]);
  return suggested;
}
