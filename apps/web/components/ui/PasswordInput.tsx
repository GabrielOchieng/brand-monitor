"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";

// A password (or other secret) field with a show/hide toggle. Same props as <input>; the type is
// managed here. The toggle is a real button (keyboard reachable, labelled) but doesn't submit.
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function PasswordInput(
  { className = "field w-full", ...props },
  ref
) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input ref={ref} {...props} type={shown ? "text" : "password"} className={`${className} pr-10`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide" : "Show"}
        aria-pressed={shown}
        title={shown ? "Hide" : "Show"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-ink-faint hover:text-ink-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        {shown ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-[18px] w-[18px]" aria-hidden="true">
            <path d="M3 3l18 18" strokeLinecap="round" />
            <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 9.6 6.2a1.6 1.6 0 0 1 0 1.6 16 16 0 0 1-2.8 3.5M6.5 6.6A15.6 15.6 0 0 0 2.4 11.2a1.6 1.6 0 0 0 0 1.6C3.5 14.8 7 19 12 19a9.6 9.6 0 0 0 4.4-1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-[18px] w-[18px]" aria-hidden="true">
            <path d="M2.4 12.8a1.6 1.6 0 0 1 0-1.6C3.5 9.2 7 5 12 5s8.5 4.2 9.6 6.2a1.6 1.6 0 0 1 0 1.6C20.5 14.8 17 19 12 19s-8.5-4.2-9.6-6.2Z" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
});
