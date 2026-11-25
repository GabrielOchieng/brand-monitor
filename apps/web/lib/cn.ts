import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Joins class names and lets a later Tailwind class override an earlier one (px-2 then px-4 -> px-4).
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
