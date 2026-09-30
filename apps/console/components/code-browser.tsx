"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, FileCode2, Folder } from "lucide-react";
import type { FileNode } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";
import { cx } from "./ui";

// Monaco (the VS Code editor) loads in the browser only.
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-mist">Loading editor…</div>,
});

/** Folders open on click; the path to the selected file starts open. */
function Tree({ nodes, selected, onSelect, depth = 0 }: { nodes: FileNode[]; selected: string; onSelect: (p: string) => void; depth?: number }) {
  return (
    <ul className="flex flex-col">
      {nodes.map((n) => (
        <li key={n.path}>{n.type === "dir" ? <Dir node={n} selected={selected} onSelect={onSelect} depth={depth} /> : <FileRow node={n} selected={selected} onSelect={onSelect} depth={depth} />}</li>
      ))}
    </ul>
  );
}

function Dir({ node, selected, onSelect, depth }: { node: FileNode; selected: string; onSelect: (p: string) => void; depth: number }) {
  const [open, setOpen] = useState(selected.startsWith(`${node.path}/`));
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] text-fog hover:bg-panel-2"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <ChevronRight className={cx("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <Folder className="size-3.5 shrink-0 text-violet" />
        <span className="truncate">{node.name}</span>
      </button>
      {open && node.children && <Tree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
    </>
  );
}

function FileRow({ node, selected, onSelect, depth }: { node: FileNode; selected: string; onSelect: (p: string) => void; depth: number }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={cx("flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[12px]", selected === node.path ? "bg-violet/15 text-ink" : "text-fog hover:bg-panel-2")}
      style={{ paddingLeft: 22 + depth * 12 }}
    >
      <FileCode2 className="size-3.5 shrink-0 text-cyan" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

/** Engineer view: the site's repository with an embedded editor (read-only in v0; edits go through the engine). */
export function CodeBrowser({ siteId, tree, initialPath }: { siteId: string; tree: FileNode[]; initialPath: string }) {
  const [path, setPath] = useState(initialPath);
  const [file, setFile] = useState<{ language: string; content: string } | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    browserApi()
      .code.file(siteId, path)
      .then((f) => !cancelled && setFile(f))
      .catch((err: unknown) => !cancelled && setFile({ language: "plaintext", content: `// Couldn't load this file.
// ${err instanceof Error ? err.message : ""}` }));
    return () => {
      cancelled = true;
    };
  }, [siteId, path]);

  return (
    <div className="grid min-h-[560px] overflow-hidden rounded-2xl border border-line bg-panel md:grid-cols-[260px_1fr]">
      <div className="max-h-[75vh] overflow-y-auto border-b border-line p-2 md:border-b-0 md:border-r">
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
