"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog, DialogContent, DialogFooter } from "./Dialog";
import { Field, Input } from "./Field";

type Options = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  // Ask for one line of text too (a ticket number, a reason). The promise then resolves to it.
  input?: { label: string; placeholder?: string; optional?: boolean };
};

type Ask = {
  (o: Options & { input: NonNullable<Options["input"]> }): Promise<string | null>;
  (o: Options): Promise<boolean>;
};

const ConfirmContext = createContext<Ask | null>(null);

// In-page confirmation instead of window.confirm/prompt: styled, accessible, and it can say
// exactly what will happen. `await ask({...})` is true/false, or the typed text / null with `input`.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<((v: boolean | string | null) => void) | null>(null);

  const ask = useCallback((o: Options) => {
    setText("");
    setOpts(o);
    return new Promise<boolean | string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []) as Ask;

  function close(ok: boolean) {
    const r = resolver.current;
    resolver.current = null;
    setOpts(null);
    if (!r) return;
    if (opts?.input) r(ok ? text.trim() : null);
    else r(ok);
  }

  const missing = !!opts?.input && !opts.input.optional && !text.trim();

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
        {opts && (
          <DialogContent title={opts.title} description={opts.body}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!missing) close(true);
              }}
              className="flex flex-col gap-3"
            >
              {opts.input && (
                <Field label={opts.input.label} htmlFor="confirm-input" hint={opts.input.optional ? "Optional" : undefined}>
                  <Input id="confirm-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={opts.input.placeholder} />
                </Field>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => close(false)}>
                  {opts.cancelLabel ?? "Cancel"}
                </Button>
                <Button type="submit" variant={opts.danger ? "danger" : "primary"} disabled={missing} autoFocus={!opts.input}>
                  {opts.confirmLabel ?? "Confirm"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ask;
}
