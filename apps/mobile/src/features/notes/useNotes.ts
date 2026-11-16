import { useEffect, useState } from 'react';
import type { Note } from '@yeongdu/shared';
import type { CategoryFilter, NoteFilter } from '@yeongdu/shared/src/local-store';
import { useRuntime } from '../../services/runtime';

export function useNotes(filter: NoteFilter, query: string, category?: CategoryFilter) {
  const { store, change, unlocked, active, categoryVersion } = useRuntime();
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!store || !unlocked || !active) {
      setNotes([]);
      return;
    }
    void store
      .list(filter, query, category)
      .then((items) => {
        if (!cancelled) {
          setNotes(items);
          setLoadedVersion(categoryVersion);
          setError('');
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setNotes([]);
          setError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store, filter, query, category, change, unlocked, active, categoryVersion]);
  return { notes: loadedVersion === categoryVersion && active && unlocked ? notes : [], error };
}
