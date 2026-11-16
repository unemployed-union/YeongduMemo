import { categoryNameSchema, type CategoryProtection } from '@yeongdu/shared';
import { flushEditors, notifyCategoryAccess, synchronize, useRuntime } from './runtime';

function store() {
  const state = useRuntime.getState();
  if (!state.active || !state.unlocked || !state.store) {
    throw new Error('앱 잠금을 해제하세요.');
  }
  return state.store;
}

export async function openCategory(name: string) {
  const category = categoryNameSchema.parse(name);
  const repository = store();
  if (await repository.canAccessCategory(category)) {
    return true;
  }
  const success = await repository.unlockCategory(category);
  if (success) {
    notifyCategoryAccess(true);
  }
  return success;
}

export async function openProtectedNote(id: string) {
  const success = await store().unlockNoteCategory(id);
  if (success) {
    notifyCategoryAccess(true);
  }
  return success;
}

export async function authorizeCategoryManagement() {
  await flushEditors();
  return store().authorizeCategoryManagement();
}

export async function updateCategoryProtection(name: string, protection: CategoryProtection) {
  await flushEditors();
  await store().setCategoryProtection(name, protection);
  void synchronize();
}
