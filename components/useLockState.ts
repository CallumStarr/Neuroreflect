'use client';

import { useSyncExternalStore } from 'react';
import { getLockState, subscribeLock, type LockState } from '@/lib/lock';

export function useLockState(): LockState {
  return useSyncExternalStore(subscribeLock, getLockState, () => 'off');
}
