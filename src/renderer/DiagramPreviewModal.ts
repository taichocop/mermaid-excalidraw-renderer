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
  private restoreOpenerFocus = true;

  constructor(app: App, readonly mount: DiagramMount, private readonly opener: HTMLButtonElement,
    private readonly closed: () => void) {
    super(app);
    this.setTitle("Mermaid diagram preview");
    // Scope parentage does not inherit the native tabFocusContainerEl field.
    // Traverse host/plugin controls through the public Scope. Canvas focus is
    // still available to pointer navigation, but is not a Tab stop in this viewer.
    this.scope.register(null, "Tab", event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return true;
      const controls = [...this.modalEl.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]",
      )].filter(node => node.tabIndex >= 0 && !node.matches(":disabled")
        && !node.closest('[inert], [aria-hidden="true"]') && node.getClientRects().length > 0
        && !node.closest(".mermaid-excalidraw-canvas")
        && node.ownerDocument.defaultView?.getComputedStyle(node).visibility === "visible");
      const current = controls.indexOf(this.modalEl.ownerDocument.activeElement as HTMLElement);
      if (controls.length) {
        const next = current === -1 ? (event.shiftKey ? controls.length - 1 : 0)
          : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault();
        controls[next]?.focus({ preventScroll: true });
        return false;
      }
      return true;
    });
  }

  closeForReplacement(): void {
    this.restoreOpenerFocus = false;
    this.shouldRestoreSelection = false;
    this.close();
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
      ...props, container: this.viewer, onClose: this.closePreview, modalScope: this.scope,
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
    if (this.restoreOpenerFocus && this.opener.isConnected) this.opener.focus({ preventScroll: true });
  }
}
