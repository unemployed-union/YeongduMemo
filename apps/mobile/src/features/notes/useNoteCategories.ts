import { useEffect, useState } from 'react';
import { useRuntime } from '../../services/runtime';
import type { CategoryDetails } from '@yeongdu/shared/src/category-access';

export function useNoteCategories() {
  const store = useRuntime((state) => state.store);
  const change = useRuntime((state) => state.change);
  const unlocked = useRuntime((state) => state.unlocked);
  const active = useRuntime((state) => state.active);
  const categoryVersion = useRuntime((state) => state.categoryVersion);
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const [details, setDetails] = useState<CategoryDetails[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!store || !unlocked || !active) {
      setDetails([]);
      setError('');
      return;
    }
    void store
      .categoryStatuses()
      .then((names) => {
        if (!cancelled) {
          setDetails(names);
          setLoadedVersion(categoryVersion);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetails([]);
          setError('카테고리 목록을 불러오지 못했습니다.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store, change, unlocked, active, categoryVersion]);

  const visible = loadedVersion === categoryVersion && active && unlocked ? details : [];
  return { categories: visible.map((item) => item.name), details: visible, error };
}
