import { useEffect, useRef, useState } from 'react';
import type { Note } from '@yeongdu/shared';
import { CategoryAccessError } from '@yeongdu/shared/src/category-access';
import { Autosave, type SaveState } from '@yeongdu/shared/src/autosave';
import { pickAttachment, type AttachmentPickMode } from '../../services/attachments';
import { openCategory, openProtectedNote } from '../../services/category-protection';
import {
  notifyChange,
  registerFlusher,
  settleSync,
  synchronize,
  useRuntime,
} from '../../services/runtime';

export function useEditor(id: string) {
  const store = useRuntime((state) => state.store)!;
  const categoryVersion = useRuntime((state) => state.categoryVersion);
  const active = useRuntime((state) => state.active);
  const unlocked = useRuntime((state) => state.unlocked);
  const [accessVersion, setAccessVersion] = useState(-1);
  const [categoryLocked, setCategoryLocked] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [status, setStatus] = useState<SaveState>('saved');
  const [error, setError] = useState('');
  const latest = useRef<Note | null>(null);
  const saver = useRef<Autosave<Note> | null>(null);
  const attachmentTicket = useRef(0);
  const attachmentBusy = useRef(false);
  const [attaching, setAttaching] = useState(false);
  useEffect(() => {
    let disposed = false;
    setInitialized(false);
    latest.current = null;
    setNote(null);
    setAccessVersion(-1);
    setCategoryLocked(false);
    setError('');
    const autosave = new Autosave<Note>(
      async (draft) => {
        await store.save(draft);
        notifyChange();
      },
      (value) => {
        if (!disposed) setStatus(value);
      },
    );
    saver.current = autosave;
    const unregister = registerFlusher(() => autosave.flush());
    void settleSync()
      .then(() => store.get(id))
      .then((found) => {
        if (!disposed) {
          latest.current = found;
          setNote(found);
          setAccessVersion(categoryVersion);
          if (!found) setError('메모를 찾을 수 없습니다.');
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setCategoryLocked(reason instanceof CategoryAccessError);
          setError(String(reason));
        }
      })
      .finally(() => {
        if (!disposed) {
          setInitialized(true);
        }
      });
    return () => {
      attachmentTicket.current++;
      disposed = true;
      void autosave
        .flush()
        .finally(() => {
          unregister();
          void synchronize();
        })
        .catch(() => undefined);
    };
  }, [id, store]);

  useEffect(() => {
    let cancelled = false;
    if (!initialized || !active || !unlocked) {
      return;
    }
    const draft = latest.current;
    const check = store.get(id).then(async (persisted) => {
      if (draft && !(await store.canAccessCategory(draft.category))) {
        throw new CategoryAccessError();
      }
      return draft ?? persisted;
    });
    void check
      .then((found) => {
        if (!cancelled) {
          if (!latest.current && found) {
            latest.current = found;
            setNote(found);
          }
          setCategoryLocked(false);
          setAccessVersion(categoryVersion);
          setError(found ? '' : '메모를 찾을 수 없습니다.');
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setCategoryLocked(reason instanceof CategoryAccessError);
          setError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store, id, categoryVersion, active, unlocked, initialized]);

  function update(patch: Partial<Note>) {
    if (
      !latest.current ||
      attachmentBusy.current ||
      categoryLocked ||
      accessVersion !== categoryVersion ||
      !active ||
      !unlocked
    ) {
      return;
    }
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setNote(next);
    saver.current?.update(next);
  }
  async function flush() {
    await saver.current?.flush();
  }
  async function attach(mode: AttachmentPickMode, offset: number) {
    if (attachmentBusy.current || !latest.current) {
      return;
    }
    attachmentBusy.current = true;
    setAttaching(true);
    const ticket = ++attachmentTicket.current;
    try {
      await flush();
      const picked = await pickAttachment(id, mode);
      if (!picked || ticket !== attachmentTicket.current) {
        return;
      }
      const draft = latest.current!;
      const saved = await store.attachFile(draft, picked.file, picked.chunks, offset);
      if (ticket === attachmentTicket.current) {
        latest.current = saved;
        setNote(saved);
        setAccessVersion(useRuntime.getState().categoryVersion);
        setCategoryLocked(false);
        notifyChange();
      }
    } finally {
      if (ticket === attachmentTicket.current) {
        attachmentBusy.current = false;
        setAttaching(false);
      }
    }
  }
  async function cleanEmpty() {
    await flush();
    if (categoryLocked || accessVersion !== categoryVersion) {
      return;
    }
    const draft = latest.current;
    if (draft && !draft.title.trim() && !draft.body.trim() && !draft.deletedAt) {
      await store.save({ ...draft, deletedAt: new Date().toISOString() });
      notifyChange();
    }
  }
  async function requestAccess() {
    try {
      await store.get(id);
    } catch (reason) {
      if (!(reason instanceof CategoryAccessError)) {
        throw reason;
      }
      if (!(await openProtectedNote(id))) {
        return false;
      }
    }
    const category = latest.current?.category;
    if (category) {
      return openCategory(category);
    }
    return true;
  }
  const visible =
    note?.id === id && accessVersion === categoryVersion && active && unlocked && !categoryLocked;
  return {
    note: visible ? note : null,
    categoryLocked,
    requestAccess,
    update,
    status,
    error,
    flush,
    cleanEmpty,
    attach,
    attaching,
  };
}
