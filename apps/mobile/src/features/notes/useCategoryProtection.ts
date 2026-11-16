import { useEffect, useState } from 'react';
import type { CategoryDetails } from '@yeongdu/shared/src/category-access';
import { authorizeCategoryManagement } from '../../services/category-protection';
import { useRuntime } from '../../services/runtime';

export function useCategoryProtection() {
  const { store, categoryVersion, change, active, unlocked } = useRuntime();
  const [categories, setCategories] = useState<CategoryDetails[]>([]);
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const [authorized, setAuthorized] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      store?.endCategoryManagement();
    },
    [store],
  );

  useEffect(() => {
    let cancelled = false;
    if (!store || !active || !unlocked) {
      return;
    }
    void store
      .categorySettings()
      .then((items) => {
        if (!cancelled) {
          setCategories(items);
          setLoadedVersion(categoryVersion);
          setAuthorized(true);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCategories([]);
          setAuthorized(false);
          setError('인증 후 카테고리 설정을 다시 불러와 주세요.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store, categoryVersion, change, active, unlocked, refresh]);

  async function requestManagement() {
    const success = await authorizeCategoryManagement();
    if (success) {
      setRefresh((value) => value + 1);
    }
  }

  const visible = authorized && loadedVersion === categoryVersion && active && unlocked;
  return { categories: visible ? categories : [], visible, error, requestManagement };
}
