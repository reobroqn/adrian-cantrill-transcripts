# Agent Knowledge Base: Chrome DevTools MCP & Browser Extension Workflows

This document records key guidelines and workflows for agents interacting with this repository and the debugging browser session.

---

## 🔌 Chrome DevTools MCP Integration

We interact with the browser remotely using the `chrome-devtools-mcp` server.

### Page Context & Limitations
* **Web Targets only:** The MCP tool `list_pages` only exposes standard web targets (e.g. `learn.cantrill.io`). Chrome internal system pages (like `chrome://extensions/`) are filtered out by the DevTools protocol or the MCP server, meaning they cannot be selected as page contexts via `select_page` directly.
* **Isolated Worlds:** Scripts executed via `evaluate_script` run in the page's main world context. They **do not** have access to extension APIs (`chrome.runtime`, `chrome.storage.local`, etc.) which are isolated.

### Navigating System Pages
To interact with system pages (like `chrome://extensions/`), you must:
1. Call `navigate_page` to send the active tab (e.g. page ID `1`) to `chrome://extensions/`.
2. Perform operations (e.g. evaluating scripts to query shadow DOM elements).
3. Call `navigate_page` to return the tab to the target web page.

---

## 🔄 Extension Reloading Workflow

Whenever extension files (`manifest.json` or `src/extension/*`) are modified, the extension must be recompiled and reloaded in Chrome:

1. **Compile the build:** Run `npm.cmd run ext:build` (Vite compiles TypeScript to `dist-extension/`).
2. **Navigate active page to extensions page:** Call `navigate_page` with `url: "chrome://extensions/"`.
3. **Trigger reload via Shadow DOM:** Because Chrome's extensions manager uses Web Components and nested Shadow Roots, standard selectors will fail. Run `evaluate_script` with the following shadow root traversal script to locate the reload button for our extension and click it:
   ```javascript
   () => {
     const manager = document.querySelector("extensions-manager");
     if (!manager) return "No manager found";
     const itemList = manager.shadowRoot.querySelector("extensions-item-list");
     if (!itemList) return "No item list found";
     const items = itemList.shadowRoot.querySelectorAll("extensions-item");
     for (const item of items) {
       const name = item.shadowRoot.querySelector("#name").textContent;
       if (name.includes("Adrian Transcript Scraper")) {
         const reloadBtn = item.shadowRoot.querySelector("#dev-reload-button");
         if (reloadBtn) {
           reloadBtn.click();
           return "Clicked reload";
         }
         return "Reload button not found";
       }
     }
     return "Extension not found";
   }
   ```
4. **Navigate back and refresh:** Navigate back to the lecture page and perform a page **reload** (`type: "reload"` in `navigate_page`) to ensure the fresh content script gets injected into the tab.

---

## 💾 Extension File Downloading Mechanics

### Content Script (Client-Side) Downloads
* **Limitation:** In Manifest V3 content scripts, trying to download a file by creating an `<a>` tag with a `blob:` URL (`URL.createObjectURL(blob)`) and calling `a.click()` triggers **Chrome sandbox security blocks**.
* **Symptom:** Chrome forces a raw download of the Blob stream, ignoring the `download` attribute. The file is saved as a **UUID with no extension** (e.g. `259525e7-f595-4935-a276-4877b8e9bad3`) containing the data, and cannot be easily opened.

### Background Service Worker (Privileged) Downloads
* **Solution:** File downloads must be executed from the background worker via the privileged `chrome.downloads` API.
* **Mechanism:** The background script processes the text and encodes it into a standard `data:` URI (e.g. `data:text/plain;charset=utf-8,...`).
* **Privileges:** Because it is initiated from the background service worker, Chrome bypasses page-level sandboxing, respects the `filename` parameter (allowing folders like `transcripts/`), and properly appends the `.txt` extension.
