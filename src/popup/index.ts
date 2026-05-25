import { getBulkState } from "../shared/storage";

console.log("Adrian Scraper popup script active.");

// Update popup UI status if bulk download is active
getBulkState().then((state) => {
    const statusEl = document.getElementById("status");
    if (statusEl && state?.active) {
        statusEl.innerText = `Bulk Downloading: ${state.completedCount}/${state.queue.length}`;
        statusEl.style.backgroundColor = "rgba(217, 119, 6, 0.15)";
        statusEl.style.color = "#fbbf24";
    }
});
