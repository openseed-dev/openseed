import { useState } from 'preact/hooks';
import { useSignalEffect, type Signal } from '@preact/signals';

export function useValue<T>(sig: Signal<T>): T {
  const [val, setVal] = useState(sig.value);
  useSignalEffect(() => { setVal(sig.value); });
  return val;
}
