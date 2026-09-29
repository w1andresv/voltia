"use client";

import { useEffect, useState } from "react";

/** `value` cuando lleva `ms` sin cambiar (el primero, enseguida). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
