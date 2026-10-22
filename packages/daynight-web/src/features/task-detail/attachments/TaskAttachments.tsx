import { useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, attachmentDownloadUrl, attachmentPreviewRoot, attachmentPreviewUrl } from '../../../api/client';
import { AttachmentPreview } from './AttachmentPreview';
import { attachmentTree, isAttachmentPath, type AttachmentNode } from './model';
import { useAttachments, type AttachmentApi } from './useAttachments';
import '../../../styles/attachments.css';

export type AttachmentUrls = {
  readonly preview: (path: string) => string;
  readonly download: (path: string) => string;
  readonly previewRoot: string;
};

type TaskAttachmentsProps = {
  readonly projectId: string;
  readonly taskId: string;
  readonly onClose: () => void;
  readonly api?: AttachmentApi;
  readonly urls?: AttachmentUrls;
};

const ErrorMessage = ({ error, message }: { readonly error: unknown; readonly message: string }) => (
  <>
    <p>{message}</p>
    {error instanceof ApiError && error.requestId !== null && <p className="request-id">请求 ID：<code>{error.requestId}</code></p>}
  </>
);

const FileTree = ({ nodes, selectedPath, onSelect }: {
  readonly nodes: readonly AttachmentNode[];
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
}) => (
  <ul className="attachment-tree">
    {nodes.map((node) => <li key={node.path}>{node.kind === 'directory' ? (
      <details open>
        <summary><span aria-hidden="true">▱</span> {node.name}</summary>
        <FileTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} />
      </details>
    ) : (
      <button className={`attachment-file${selectedPath === node.path ? ' attachment-file-selected' : ''}`} type="button" aria-pressed={selectedPath === node.path} onClick={() => onSelect(node.path)}>
        <span className="attachment-file-icon" aria-hidden="true">▤</span>
        <span className="attachment-file-name">{node.name}</span>
        <span className="attachment-file-size">{node.attachment.sizeBytes.toLocaleString('zh-CN')} B</span>
      </button>
    )}</li>)}
  </ul>
);

const TaskAttachmentContent = ({ projectId, taskId, api, urls, onClose }: TaskAttachmentsProps) => {
  const attachments = useAttachments(projectId, taskId, api);
  const headingId = useId();
  const fileId = useId();
  const pathId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState('');
  const [pathError, setPathError] = useState(false);
  const selected = attachments.items.find((item) => item.path === attachments.selectedPath);
  const busy = attachments.write.status !== 'idle';
  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (file === null) return;
    if (!isAttachmentPath(path)) {
      setPathError(true);
      return;
    }
    if (await attachments.put(path, file)) {
      setFile(null);
      setPath('');
      fileInput.current!.value = '';
    }
  };

  return (
    <section className="drawer-section task-attachments" aria-labelledby={headingId}>
      <div className="attachment-section-heading">
        <h4 id={headingId}>附件{attachments.complete ? ` · ${attachments.items.length}` : ''}</h4>
        <button className="button" type="button" disabled={attachments.loading || busy} onClick={attachments.reload}>刷新附件</button>
      </div>
      <form className="attachment-upload" onSubmit={(event) => { void upload(event); }}>
        <label htmlFor={fileId}>选择一个文件</label>
        <input id={fileId} ref={fileInput} type="file" disabled={busy} onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          setFile(chosen === undefined ? null : chosen);
          setPath(chosen === undefined ? '' : chosen.name);
          setPathError(false);
        }} />
        <label htmlFor={pathId}>目标相对路径</label>
        <div className="attachment-upload-target">
          <input id={pathId} type="text" value={path} placeholder="例如 docs/design.md" disabled={busy} aria-invalid={pathError} onChange={(event) => { setPath(event.currentTarget.value); setPathError(false); }} />
          <button className="button primary" type="submit" disabled={file === null || busy}>{attachments.write.status === 'saving' ? '正在上传…' : '上传文件'}</button>
        </div>
        <p className="attachment-hint">每次上传一个文件；相同路径会直接覆盖。</p>
        {pathError && <p className="attachment-error" role="alert">请输入有效的相对文件路径，使用 / 分隔目录，不含空段、. 或 ..。</p>}
      </form>
      {attachments.write.error !== null && <div className="attachment-error attachment-state" role="alert"><ErrorMessage error={attachments.write.error} message="附件操作失败，请检查后重试。" /></div>}
      {attachments.loading && <p className="attachment-state" role="status">正在加载附件…</p>}
      {attachments.error !== null && (
        <div className="attachment-state attachment-error" role="alert">
          <ErrorMessage error={attachments.error} message={attachments.items.length === 0 ? '附件列表加载失败。' : '附件列表尚未完整加载，以下仅显示已读取的文件。'} />
          <button className="button" type="button" disabled={busy} onClick={attachments.reload}>重试附件</button>
        </div>
      )}
      {attachments.complete && attachments.items.length === 0 && <p className="attachment-state">暂无附件，上传文件后即可在这里浏览。</p>}
      {attachments.items.length > 0 && <nav className="attachment-files" aria-label="附件文件"><FileTree nodes={attachmentTree(attachments.items)} selectedPath={attachments.selectedPath} onSelect={attachments.select} /></nav>}
      {selected === undefined ? (attachments.items.length > 0 && <p className="attachment-state">选择文件查看预览、下载或删除。</p>) : (
        <section className="attachment-preview" aria-label="附件预览">
          <header className="attachment-preview-header">
            <div><h5>{selected.path}</h5><p>{selected.contentType} · {selected.sizeBytes.toLocaleString('zh-CN')} B</p></div>
            <div className="attachment-preview-actions">
              <a className="button" href={urls === undefined ? attachmentDownloadUrl(projectId, taskId, selected.path) : urls.download(selected.path)} download>下载</a>
              <button className="button attachment-delete" type="button" disabled={busy} onClick={() => { void attachments.remove(selected.path); }}>{attachments.write.status === 'deleting' ? '正在删除…' : '删除'}</button>
            </div>
          </header>
          <AttachmentPreview key={`${selected.path}/${selected.updatedAt}`} attachment={selected} preview={attachments.preview} url={urls === undefined ? attachmentPreviewUrl(projectId, taskId, selected.path) : urls.preview(selected.path)} previewRoot={urls === undefined ? attachmentPreviewRoot(projectId, taskId) : urls.previewRoot} onRetry={attachments.retryPreview} onClose={onClose} />
        </section>
      )}
    </section>
  );
};

export const TaskAttachments = (props: TaskAttachmentsProps) => <TaskAttachmentContent key={`${props.projectId}/${props.taskId}`} {...props} />;
