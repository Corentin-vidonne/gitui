import { useTranslation } from "react-i18next";

/**
 * Small, theme-aware loading spinner (a rotating ring). Colors resolve through
 * the `neutral`/`indigo` CSS variables, so it follows the active theme without
 * any per-theme branching. Size is controlled by the `className` (h-/w-).
 */
export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="status"
      aria-label={t("spinner.loading")}
      className={`inline-block animate-spin rounded-full border-2 border-neutral-700 border-t-indigo-500 ${className}`}
    />
  );
}
