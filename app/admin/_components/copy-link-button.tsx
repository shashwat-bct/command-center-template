"use client";

import { useCallback, useState } from "react";

export default function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [path]);
  return (
    <button type="button" onClick={copy} className="g-btn-text">
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
