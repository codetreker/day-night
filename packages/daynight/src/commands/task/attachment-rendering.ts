import { stringifyApiJson } from "../../api/json.js";
import type { TaskAttachment } from "../../api/types.js";
import { terminalText } from "../../platform/terminal.js";

export const renderAttachment = (attachment: TaskAttachment): string => [
  `Path: ${terminalText(attachment.path)}`,
  `Content type: ${terminalText(attachment.contentType)}`,
  `Size: ${attachment.sizeBytes} bytes`,
  `Created: ${terminalText(attachment.createdAt)}`,
  `Updated: ${terminalText(attachment.updatedAt)}`,
  "",
].join("\n");

export const renderAttachmentList = (attachments: readonly TaskAttachment[]): string =>
  attachments.length === 0 ? "No attachments.\n" : attachments.map(renderAttachment).join("\n");

type TreeNode = { children: Map<string, TreeNode>; file: boolean };

export const renderAttachmentTree = (attachments: readonly TaskAttachment[]): string => {
  if (attachments.length === 0) return "No attachments.\n";
  const root: TreeNode = { children: new Map(), file: false };
  for (const attachment of attachments) {
    let node = root;
    for (const segment of attachment.path.split("/")) {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = { children: new Map(), file: false };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.file = true;
  }
  const render = (node: TreeNode, prefix: string): string[] => {
    const entries = [...node.children].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return entries.flatMap(([name, child], index) => {
      const last = index === entries.length - 1;
      return [`${prefix}${last ? "└── " : "├── "}${terminalText(name)}${child.file ? "" : "/"}`, ...render(child, `${prefix}${last ? "    " : "│   "}`)];
    });
  };
  return `${render(root, "").join("\n")}\n`;
};

export const renderAttachmentJson = (attachments: readonly TaskAttachment[]): string => `${stringifyApiJson(attachments)}\n`;
