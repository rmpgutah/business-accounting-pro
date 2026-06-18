import { useEffect, useState, useCallback } from 'react';
import { useCompanyStore } from '../../../stores/companyStore';
import { widgetDef } from './registry';

export function useWidgetData(type: string) {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const def = widgetDef(type);
    if (!def || !activeCompany) { setLoading(false); return; }
    setLoading(true);
    Promise.resolve(def.load(activeCompany.id))
      .then((d) => { setData(d); })
      .finally(() => setLoading(false));
  }, [type, activeCompany]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refresh: load };
}
