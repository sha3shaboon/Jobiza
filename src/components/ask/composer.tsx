"use client";

import { useEffect, useRef } from "react";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to about eight lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  return (
    <form
      className="flex items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="question" className="sr-only">
        Your question
      </label>
      <textarea
        ref={ref}
        id="question"
        name="question"
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        className="input min-h-12 flex-1 resize-none py-3 leading-normal"
      />
      {streaming ? (
        <button type="button" className="btn-secondary min-h-12" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button className="btn-primary min-h-12" disabled={disabled || !value.trim()}>
          Ask
        </button>
      )}
    </form>
  );
}
