import { Modal, type App } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DiagramErrorBoundary, ExcalidrawView } from "./ExcalidrawView";
import type { DiagramMount } from "./DiagramMount";

/** The host owns focus trapping, backdrop and native close behavior. The
 * rendering session owns this root and closes it before its source disappears. */
export class DiagramPreviewModal extends Modal {
  private root: Root | null = null;
  private viewer: HTMLElement | null = null;
  private readonly closePreview = () => this.close();
  private ownerWindow: Window | null = null;

  constructor(app: App, readonly mount: DiagramMount, private readonly opener: HTMLButtonElement,
    private readonly closed: () => void) {
    super(app);
    this.setTitle("Mermaid diagram preview");
  }

  onOpen(): void {
    this.modalEl.classList.add("mermaid-excalidraw-modal");
    this.modalEl.setAttribute("aria-label", "Mermaid diagram preview");
    this.contentEl.replaceChildren();
    // Modal opens in Obsidian's active window. All owned DOM, focus, observers
    // and cancellation use that document rather than the importing window.
    this.viewer = this.contentEl.ownerDocument.createElement("div");
    this.viewer.className = "mermaid-excalidraw-container mermaid-excalidraw-enlarged";
    this.contentEl.append(this.viewer);
    this.ownerWindow = this.viewer.ownerDocument.defaultView;
    this.ownerWindow?.addEventListener("pagehide", this.closePreview);
    this.root = createRoot(this.viewer);
    this.refresh();
    // React installs the controls asynchronously; focus the host content now.
    // The boundary installs its scope in layout effect, before user input.
    this.viewer.tabIndex = -1;
    this.viewer.focus({ preventScroll: true });
  }

  refresh(): void {
    const props = this.mount.viewProps;
    if (!props || !this.root || !this.viewer) return;
    this.viewer.style.setProperty("--background-primary", props.appearance.background);
    this.root.render(createElement(DiagramErrorBoundary, { children: createElement(ExcalidrawView, {
      ...props, container: this.viewer, onClose: this.closePreview,
    }) }));
  }

  onClose(): void {
    this.ownerWindow?.removeEventListener("pagehide", this.closePreview);
    this.ownerWindow = null;
    this.root?.unmount();
    this.root = null;
    this.viewer = null;
    this.contentEl.replaceChildren();
    this.closed();
    // A disposed/replaced editor widget is no longer a valid focus target.
    if (this.opener.isConnected) this.opener.focus({ preventScroll: true });
  }
}
