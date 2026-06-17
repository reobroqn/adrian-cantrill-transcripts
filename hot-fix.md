# Hot-Fix Plan: Direct Fetching Fix & Test Strategy

This document details the root causes and proposed fixes for the direct-fetching pipeline on the `chore/clean-code` branch, along with the step-by-step test strategy using `chrome-devtools-mcp`.

---

## 🔍 Root Cause Analysis

1. **Subdomain Wildcard Issues in MV3:**
   The master playlists and VTT segments are fetched from subdomains like `vod-akm.play.hotmart.com` or `vod-cache.play.hotmart.com`. The existing host permission `https://*.hotmart.com/*` in `manifest.json` does not cover these two-level subdomains. Thus, request interception/header spoofing fails on them.
2. **Corrupted Base Directory Paths:**
   Hotmart's tokenized URLs contain forward slashes in their query parameters (e.g., `acl=/*`). Running `url.lastIndexOf("/")` directly on the query-appended playlist URL matches a slash in the query parameters rather than the actual URL path, resulting in a corrupted base directory (like `https://vod-akm.play.hotmart.com/video/pRQK33KKLB/hls/master.m3u8?token=.../hls/`).
3. **Missing Referer and Origin Headers:**
   Background fetches lack standard `Referer` and `Origin` headers required by the CDN, leading to `403 Forbidden` errors if the extension fails to intercept and modify them.

---

## 🛠️ Proposed Changes

### 1. Update Host Permissions
**File:** [manifest.json](file:///d:/Projects/adrian-transcript/manifest.json)
```diff
   "host_permissions": [
     "https://learn.cantrill.io/*",
-    "https://*.hotmart.com/*"
+    "https://*.hotmart.com/*",
+    "https://*.play.hotmart.com/*"
   ],
```

### 2. Strip Query Parameters Before Finding Directory Base Path
**File:** [src/background/index.ts](file:///d:/Projects/adrian-transcript/src/background/index.ts)
Update `downloadTranscriptDirect` to clean the URL path before calling `lastIndexOf("/")`:
```typescript
// For Master Playlist base directory
const queryIndex = masterUrl.indexOf("?");
const cleanMasterUrl = queryIndex !== -1 ? masterUrl.substring(0, queryIndex) : masterUrl;
const baseUrl = cleanMasterUrl.substring(0, cleanMasterUrl.lastIndexOf("/") + 1);
```
And similarly for `subtitleUrl`:
```typescript
const subQueryIndex = subtitleUrl.indexOf("?");
const cleanSubtitleUrl = subQueryIndex !== -1 ? subtitleUrl.substring(0, subQueryIndex) : subtitleUrl;
const subBaseUrl = cleanSubtitleUrl.substring(0, cleanSubtitleUrl.lastIndexOf("/") + 1);
```

### 3. Ensure declarativeNetRequest Rules Apply to All Requests
**File:** [src/background/index.ts](file:///d:/Projects/adrian-transcript/src/background/index.ts)
Remove the `resourceTypes: ["xmlhttprequest"]` condition constraint from the header spoofing rule in `setupHeadersSpoofing` so that both `fetch` and standard media/page requests get the headers applied.

---

## 🧪 Test Strategy using Chrome DevTools MCP

We will execute the following automated steps to test and verify the fix:

1. **Rebuild the Extension:**
   Run `npm run build` (or the appropriate compile command) to output files into `dist/` or `dist-extension/`.
2. **Reload the Extension in Chrome:**
   - Navigate page 1 to `chrome://extensions/`.
   - Run the custom shadow DOM traversal script to click the reload button for "Adrian Transcript Scraper".
3. **Navigate to the Test Lecture Page:**
   - Select page 2 (`https://learn.cantrill.io/courses/1820301/lectures/41301611`).
   - Call `navigate_page` with type `"reload"` to reload the page and inject the fresh content script.
4. **Trigger Download:**
   - Use `evaluate_script` to click the `#adrian-scraper-ui` "Download Current" button.
5. **Inspect logs:**
   - Check page console messages using `list_console_messages` to verify video ID resolution.
   - If downloading fails, check background console/network using MCP tools.
