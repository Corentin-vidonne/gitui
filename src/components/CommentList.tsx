import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Comment, Review } from "../lib/types";
import i18n from "../lib/i18n";

function reviewColor(state: string): string {
  if (state === "APPROVED") return "text-emerald-400";
  if (state === "CHANGES_REQUESTED") return "text-red-400";
  return "text-neutral-400";
}
function reviewLabel(state: string): string {
  if (state === "APPROVED") return i18n.t("commentList.review.approved");
  if (state === "CHANGES_REQUESTED") return i18n.t("commentList.review.changesRequested");
  if (state === "COMMENTED") return i18n.t("commentList.review.commented");
  if (state === "DISMISSED") return i18n.t("commentList.review.dismissed");
  return state.toLowerCase();
}
function when(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

function Bubble({
  author,
  meta,
  metaClass,
  body,
}: {
  author: string;
  meta: string;
  metaClass?: string;
  body: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/50 p-2">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="font-medium text-neutral-200">{author || "—"}</span>
        {meta && <span className={metaClass ?? "text-neutral-500"}>{meta}</span>}
      </div>
      {body.trim() ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-xs text-neutral-300">
          {body}
        </pre>
      ) : (
        <span className="text-xs italic text-neutral-600">{t("commentList.noMessage")}</span>
      )}
    </div>
  );
}

/** Renders PR reviews (with verdict) followed by conversation comments. */
export function CommentList({
  comments,
  reviews = [],
}: {
  comments: Comment[];
  reviews?: Review[];
}) {
  const { t } = useTranslation();
  const total = comments.length + reviews.length;
  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-neutral-500">
        <MessageSquare className="h-3.5 w-3.5" /> {t("commentList.conversation", { total })}
      </h4>
      {total === 0 && <p className="text-xs text-neutral-600">{t("commentList.noMessages")}</p>}
      <div className="space-y-2">
        {reviews.map((r, i) => (
          <Bubble
            key={`r-${i}`}
            author={r.author}
            meta={`${reviewLabel(r.state)}${r.createdAt ? " · " + when(r.createdAt) : ""}`}
            metaClass={reviewColor(r.state)}
            body={r.body}
          />
        ))}
        {comments.map((c, i) => (
          <Bubble key={`c-${i}`} author={c.author} meta={when(c.createdAt)} body={c.body} />
        ))}
      </div>
    </div>
  );
}
