import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

const inputClass =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600";

/** Shared modal to create or rename a group. Confirm is disabled on empty input. */
export function GroupNameDialog({
  title,
  initial = "",
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const valid = name.trim().length > 0;

  function submit() {
    if (!valid) return;
    onSubmit(name.trim());
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={t("groupNameDialog.placeholder")}
          className={inputClass}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
