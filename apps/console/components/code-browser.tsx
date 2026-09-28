"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, FileCode2, Folder } from "lucide-react";
import type { FileNode } from "@accelerator/domain";

import { browserApi } from "@/lib/api";
import { cx } from "./ui";

// Monaco (the VS Code editor) loads in the browser only.
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-mist">Loading editor…</div>,
});

function Tree({ nodes, selected, onSelect, depth = 0 }: { nodes: FileNode[]; selected: string; onSelect: (p: string) => void; depth?: number }) {
  return (
    <ul className="flex flex-col">
      {nodes.map((n) => (
        <li key={n.path}>
          {n.type === "dir" ? (
            <>
              <div className="flex items-center gap-1.5 px-2 py-1 text-[12.5px] text-fog" style={{ paddingLeft: 8 + depth * 12 }}>
                <ChevronRight className="size-3.5 rotate-90" />
                <Folder className="size-3.5 text-violet" />
                {n.name}
              </div>
              {n.children && <Tree nodes={n.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
            </>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(n.path)}
              className={cx(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[12px]",
                selected === n.path ? "bg-violet/15 text-ink" : "text-fog hover:bg-panel-2",
              )}
              style={{ paddingLeft: 22 + depth * 12 }}
            >
              <FileCode2 className="size-3.5 shrink-0 text-cyan" />
              <span className="truncate">{n.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Engineer view: the site's repository with an embedded editor (read-only in v0; edits go through the engine). */
export function CodeBrowser({ siteId, tree, initialPath }: { siteId: string; tree: FileNode[]; initialPath: string }) {
  const [path, setPath] = useState(initialPath);
  const [file, setFile] = useState<{ language: string; content: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .code.file(siteId, path)
      .then((f) => !cancelled && setFile(f))
      .catch(() => !cancelled && setFile({ language: "plaintext", content: "// Couldn't load this file." }));
    return () => {
      cancelled = true;
    };
  }, [siteId, path]);

  return (
    <div className="grid min-h-[560px] overflow-hidden rounded-2xl border border-line bg-panel md:grid-cols-[260px_1fr]">
      <div className="border-b border-line p-2 md:border-b-0 md:border-r">
        <Tree nodes={tree} selected={path} onSelect={setPath} />
      </div>
      <div className="flex min-h-[520px] flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-2 font-mono text-[12px] text-mist">
          <span className="truncate">{path}</span>
          <span>read-only · edits go through a change</span>
        </div>
        <div className="flex-1">
          {file && (
            <Editor
              height="100%"
              theme="vs-dark"
              language={file.language}
              value={file.content}
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
