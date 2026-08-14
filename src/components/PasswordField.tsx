"use client";

import { useState } from "react";

/**
 * A password box with an eye on it.
 *
 * Worth more at signup than anywhere else: this is the one moment the word is
 * being invented rather than remembered, there is no second box to confirm it
 * against, and a typo here locks someone out of an account they haven't
 * finished making. Hidden again by default on every page load — showing is a
 * deliberate act, over someone's shoulder is a real place to be.
 */
export default function PasswordField({
  name,
  label,
  minLength,
  autoComplete,
  show,
  hide,
}: {
  name: string;
  label: string;
  minLength?: number;
  autoComplete?: string;
  show: string;
  hide: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label>
      {label}
      <span className="password-field">
        <input
          type={visible ? "text" : "password"}
          name={name}
          required
          minLength={minLength}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-reveal"
          onClick={() => setVisible((on) => !on)}
          aria-label={visible ? hide : show}
          title={visible ? hide : show}
          // Never a submit, and never in the tab order between the field and
          // the button that finishes the form.
          tabIndex={-1}
        >
          {visible ? "🙈" : "👁"}
        </button>
      </span>
    </label>
  );
}
