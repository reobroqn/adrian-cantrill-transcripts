import { getBulkState } from "../shared/storage";

export interface UICallbacks {
    onScan: () => void;
    onDownloadCurrent: () => void;
    onDownloadAll: () => void;
    onCancel: () => void;
}

export function createModernButton(
    text: string,
    bgColor: string,
    hoverBgColor: string,
    onClick: () => void,
): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.innerText = text;
    btn.style.width = "100%";
    btn.style.padding = "8px 12px";
    btn.style.backgroundColor = bgColor;
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.style.fontWeight = "600";
    btn.style.fontSize = "12px";
    btn.style.transition = "all 0.2s ease";
    btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";

    btn.onmouseover = () => {
        btn.style.backgroundColor = hoverBgColor;
        btn.style.transform = "translateY(-1px)";
        btn.style.boxShadow = "0 4px 6px rgba(0,0,0,0.15)";
    };
    btn.onmouseout = () => {
        btn.style.backgroundColor = bgColor;
        btn.style.transform = "translateY(0)";
        btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
    };
    btn.onclick = onClick;
    return btn;
}

export function updateStatus(status: string) {
    const el = document.getElementById("adrian-status");
    if (el) el.innerText = `Status: ${status}`;
}

export function showProgress(completedCount: number, total: number) {
    const statusEl = document.getElementById("adrian-status");
    if (statusEl) {
        statusEl.innerText = `Bulk: ${completedCount}/${total}`;
    }
    const container = document.getElementById("adrian-progress-container");
    const bar = document.getElementById("adrian-progress-bar");
    if (container && bar) {
        container.style.display = "block";
        const percent = Math.min(
            100,
            Math.max(0, (completedCount / total) * 100),
        );
        bar.style.width = `${percent}%`;
    }
    const cancelBtn = document.getElementById("adrian-cancel-btn");
    if (cancelBtn) {
        cancelBtn.style.display = "block";
    }
    const downloadAllBtn = document.getElementById("adrian-download-all-btn");
    if (downloadAllBtn) {
        downloadAllBtn.style.display = "none";
    }
}

export function showFinished() {
    updateStatus("Completed!");
    const container = document.getElementById("adrian-progress-container");
    if (container) {
        container.style.display = "none";
    }
    const cancelBtn = document.getElementById("adrian-cancel-btn");
    if (cancelBtn) {
        cancelBtn.style.display = "none";
    }
    const downloadAllBtn = document.getElementById("adrian-download-all-btn");
    if (downloadAllBtn) {
        downloadAllBtn.style.display = "block";
    }
    alert("Bulk download completed!");
}

export function showCancelled() {
    updateStatus("Cancelled");
    const container = document.getElementById("adrian-progress-container");
    if (container) {
        container.style.display = "none";
    }
    const cancelBtn = document.getElementById("adrian-cancel-btn");
    if (cancelBtn) {
        cancelBtn.style.display = "none";
    }
    const downloadAllBtn = document.getElementById("adrian-download-all-btn");
    if (downloadAllBtn) {
        downloadAllBtn.style.display = "block";
    }
    alert("Bulk download cancelled.");
}

export function injectUI(callbacks: UICallbacks) {
    if (document.getElementById("adrian-scraper-ui")) return;

    const card = document.createElement("div");
    card.id = "adrian-scraper-ui";
    card.style.position = "fixed";
    card.style.bottom = "20px";
    card.style.right = "20px";
    card.style.zIndex = "99999";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "10px";
    card.style.padding = "16px";
    card.style.background = "rgba(28, 28, 35, 0.85)";
    card.style.backdropFilter = "blur(12px)";
    card.style.setProperty("-webkit-backdrop-filter", "blur(12px)");
    card.style.border = "1px solid rgba(255, 255, 255, 0.08)";
    card.style.borderRadius = "12px";
    card.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.35)";
    card.style.fontFamily =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    card.style.color = "#f3f4f6";
    card.style.width = "220px";

    // Header Title
    const header = document.createElement("div");
    header.style.fontWeight = "700";
    header.style.fontSize = "14px";
    header.style.color = "#ffffff";
    header.style.letterSpacing = "0.5px";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "6px";
    header.innerHTML = "<span>🍊</span> Adrian Scraper";
    card.appendChild(header);

    // Status text
    const statusEl = document.createElement("div");
    statusEl.id = "adrian-status";
    statusEl.style.fontSize = "11px";
    statusEl.style.color = "#9ca3af";
    statusEl.style.marginBottom = "4px";
    statusEl.innerText = "Status: Ready";
    card.appendChild(statusEl);

    // Progress Bar Container
    const progContainer = document.createElement("div");
    progContainer.id = "adrian-progress-container";
    progContainer.style.display = "none";
    progContainer.style.width = "100%";
    progContainer.style.height = "4px";
    progContainer.style.background = "rgba(255, 255, 255, 0.1)";
    progContainer.style.borderRadius = "2px";
    progContainer.style.overflow = "hidden";
    progContainer.style.marginBottom = "4px";

    const progBar = document.createElement("div");
    progBar.id = "adrian-progress-bar";
    progBar.style.width = "0%";
    progBar.style.height = "100%";
    progBar.style.background = "#3b82f6";
    progBar.style.transition = "width 0.3s ease";

    progContainer.appendChild(progBar);
    card.appendChild(progContainer);

    // 1. Scan Course Button (Amber/Orange)
    const scanBtn = createModernButton(
        "🔍 Scan Course",
        "#d97706",
        "#b45309",
        callbacks.onScan,
    );
    card.appendChild(scanBtn);

    // 2. Download Current Button (Emerald/Green)
    const downloadBtn = createModernButton(
        "💾 Download Current",
        "#059669",
        "#047857",
        callbacks.onDownloadCurrent,
    );
    card.appendChild(downloadBtn);

    // 3. Download All Button (Blue/Royal)
    const downloadAllBtn = createModernButton(
        "📥 Download All",
        "#2563eb",
        "#1d4ed8",
        callbacks.onDownloadAll,
    );
    downloadAllBtn.id = "adrian-download-all-btn";
    card.appendChild(downloadAllBtn);

    // 4. Cancel Bulk Button (Red/Danger)
    const cancelBtn = createModernButton(
        "❌ Cancel Bulk",
        "#ef4444",
        "#dc2626",
        callbacks.onCancel,
    );
    cancelBtn.id = "adrian-cancel-btn";
    cancelBtn.style.display = "none";
    card.appendChild(cancelBtn);

    document.body.appendChild(card);

    // Restore progress UI if bulk download is active
    getBulkState().then((state) => {
        if (state?.active) {
            showProgress(state.completedCount, state.queue.length);
        }
    });
}
